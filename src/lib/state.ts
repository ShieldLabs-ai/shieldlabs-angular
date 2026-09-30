import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  inject,
  InjectionToken,
  Injector,
  isDevMode,
  NgZone,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import {
  load,
  ShieldLabsError,
  type IdentifyOptions,
  type IdentifyResult,
  type InteractionIdentifier,
  type LoadOptions,
  type ShieldLabsAgent,
  type ShieldLabsErrorCode,
} from '@shieldlabs/js';

import {
  handled,
  handledRejection,
  isShieldLabsError,
  missingProvider,
  rejectBeforeLoad,
  rejectOnServer,
  toShieldLabsError,
} from './errors';
import type { ShieldLabsOptions, ShieldLabsRef, ShieldLabsStatus } from './types';

/** Internal: the agent state of one `provideShieldLabs()` call. Not exported from the package. */
export const SHIELDLABS_STATE = new InjectionToken<ShieldLabsState>('ShieldLabsState');

/** Milliseconds a call may take when neither the call nor the provider sets a timeout (as in `@shieldlabs/js`). */
const DEFAULT_TIMEOUT = 10000;

/** The largest timeout that `@shieldlabs/js` (and `setTimeout`) accepts. */
const MAX_TIMEOUT = 2147483647;

/** Load errors caused by the setup rather than by the visitor: logged once in development mode. */
const SETUP_ERRORS: readonly ShieldLabsErrorCode[] = ['invalid_options', 'unsupported_environment'];

const LOAD_FAILED = 'Could not load the ShieldLabs agent.';

function noop(): void {
  // Errors are already reported through the signals.
}

/** The two call options this package reads. Anything else goes to the agent as it is. */
interface CallFields {
  readonly userId?: unknown;
  readonly timeout?: unknown;
}

function isObject(value: unknown): value is CallFields {
  return typeof value === 'object' && value !== null;
}

/** A timeout that `@shieldlabs/js` accepts. */
function isTimeout(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && value <= MAX_TIMEOUT;
}

/** The User HID of call options, `undefined` for an anonymous call. */
function userOf(options: unknown): string | undefined {
  return isObject(options) && typeof options.userId === 'string' ? options.userId : undefined;
}

/**
 * The options for an agent call that waited for the agent since `startedAt`: the time left of the
 * call's `budget` becomes its timeout, so that the wait and the answer together stay within one
 * timeout. Options that are not an object, and an invalid timeout, go to the agent as they are, and
 * `@shieldlabs/js` rejects them with `invalid_options`.
 */
function withTimeLeft(options: IdentifyOptions | undefined, budget: number, startedAt: number): IdentifyOptions | undefined {
  const given: unknown = options;
  if (given !== undefined && given !== null && !isObject(given)) return options;
  if (isObject(given) && given.timeout !== undefined && !isTimeout(given.timeout)) return options;
  const left = budget - (Date.now() - startedAt);
  // Clamped: at least 1 ms for an agent that arrived just in time, at most the budget if the clock went back.
  return { ...options, timeout: Math.min(budget, Math.max(1, left)) };
}

/** Drops options that are `undefined`, so that `load()` only sees the options that were given. */
function definedOptions(options: LoadOptions): LoadOptions {
  // `load()` validates the options and rejects with `invalid_options`, for example without a publicKey.
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as unknown as LoadOptions;
}

function checkOnLoadOf(value: ShieldLabsOptions['checkOnLoad']): IdentifyOptions | null {
  // `false`, `undefined`, and `null` from JavaScript callers, turn it off.
  if (!value) return null;
  if (value === true) return {};
  return value.userId === undefined ? {} : { userId: value.userId };
}

/**
 * Loads the agent once per provider, in the browser only, and keeps its state in signals.
 *
 * - With `autoLoad` (the default), loading starts after the first render (`afterNextRender`) or on
 *   the first call, whichever comes first. With `autoLoad: false`, only `load()` starts it. `load()`
 *   of `@shieldlabs/js` is memoized as well, so the agent is imported once per page.
 * - A call that has to wait for the agent gets one timeout for the wait and the answer together.
 * - During server-side rendering nothing is loaded, the state stays `'loading'` and calls reject
 *   with `unsupported_environment` without touching the signals.
 * - The agent runs outside the Angular zone, so its timers and listeners do not trigger change
 *   detection or keep the app from becoming stable. Signal updates re-enter the zone.
 */
export class ShieldLabsState {
  readonly isBrowser: boolean = isPlatformBrowser(inject(PLATFORM_ID));
  readonly ref: ShieldLabsRef;
  /**
   * How long a call without a timeout of its own may take in all: the provider timeout or the
   * default. `injectIdentify()` counts such a call as one with this timeout.
   */
  readonly defaultTimeout: number;

  private readonly zone = inject(NgZone);
  private readonly injector = inject(Injector);
  private readonly status = signal<ShieldLabsStatus>('loading');
  private readonly error = signal<ShieldLabsError | null>(null);
  private readonly loadOptions: LoadOptions;
  private readonly checkOnLoad: IdentifyOptions | null;
  private readonly autoLoad: boolean;

  /** `true` once the agent may load: from the start with `autoLoad`, otherwise after `load()`. */
  private allowed: boolean;
  /** Resumes the `getAgent()` calls made before `load()` allowed loading. */
  private resumeWaiting: (() => void) | undefined;
  private readonly whenAllowed: Promise<void>;
  /** The running or finished load. Cleared after a failure, so that the next call loads again. */
  private agent: Promise<ShieldLabsAgent> | undefined;
  /** The agent once it is loaded: calls reach it without waiting. */
  private loaded: ShieldLabsAgent | undefined;
  /** What `getAgent()` resolves, made once for the loaded agent. */
  private exposed: { readonly from: ShieldLabsAgent; readonly agent: ShieldLabsAgent } | undefined;
  private scheduled = false;
  private checked = false;
  /** Calls of the app that have not settled yet, per User HID (`undefined` for anonymous calls). */
  private readonly running = new Map<string | undefined, number>();
  private readonly warned = new Set<ShieldLabsErrorCode>();

  constructor(options: ShieldLabsOptions) {
    // Everything except the two options of this package goes to `load()`, including load options
    // that later 1.x versions of @shieldlabs/js add.
    const { checkOnLoad, autoLoad, ...loadOptions } = options;
    this.loadOptions = definedOptions(loadOptions);
    this.checkOnLoad = checkOnLoadOf(checkOnLoad);
    this.autoLoad = autoLoad !== false;
    this.allowed = this.autoLoad;
    this.defaultTimeout = isTimeout(loadOptions.timeout) ? loadOptions.timeout : DEFAULT_TIMEOUT;
    this.whenAllowed = new Promise<void>((resolve) => {
      this.resumeWaiting = resolve;
    });
    this.ref = Object.freeze({
      status: this.status.asReadonly(),
      error: this.error.asReadonly(),
      identify: (callOptions?: IdentifyOptions) => this.identify(callOptions),
      check: (callOptions?: IdentifyOptions) => this.check(callOptions),
      load: () => {
        this.load();
      },
      getAgent: () => this.getAgent(),
    });
  }

  /** Runs from the environment initializer: in the browser, load the agent after the first render. */
  scheduleLoad(): void {
    if (!this.isBrowser || !this.autoLoad || this.scheduled) return;
    this.scheduled = true;
    afterNextRender(
      () => {
        this.start();
      },
      { injector: this.injector },
    );
  }

  /** Allows the agent to load and starts loading it, unless a load runs or the agent is ready. */
  load(): void {
    if (!this.isBrowser) return;
    this.allowed = true;
    this.resumeWaiting?.();
    this.resumeWaiting = undefined;
    this.start();
  }

  getAgent(): Promise<ShieldLabsAgent> {
    if (!this.isBrowser) return rejectOnServer('getAgent()');
    // Before load() (autoLoad: false) the call waits for it, without a time limit of its own.
    const loading = this.allowed ? this.ready() : this.whenAllowed.then(() => this.ready());
    // Marked as handled: a failed load is also reported in `status` and `error`.
    return handled(loading.then((agent) => this.expose(agent)));
  }

  identify(options?: IdentifyOptions): Promise<IdentifyResult> {
    return this.run('identify()', options, (agent, agentOptions) => agent.identify(agentOptions));
  }

  check(options?: IdentifyOptions): Promise<IdentifyResult | null> {
    // Before load() with autoLoad: false the check is skipped at once, as the agent skips a check it
    // does not run (`check()` of @shieldlabs/js resolves null for not_initialized).
    if (this.isBrowser && !this.allowed) return Promise.resolve(null);
    return this.run('check()', options, (agent, agentOptions) => agent.check(agentOptions));
  }

  /** Updates signals inside the Angular zone and outside any reactive context (effects, templates). */
  write(update: () => void): void {
    this.zone.run(() => {
      untracked(update);
    });
  }

  private start(): void {
    this.ready().catch(noop);
  }

  /**
   * The loaded agent. Starts loading on first use; after a failed load, the next call retries.
   * Callers check `isBrowser` and `allowed` first.
   */
  private ready(): Promise<ShieldLabsAgent> {
    if (this.agent) return this.agent;
    if (untracked(this.status) === 'error') {
      this.write(() => {
        this.status.set('loading');
        this.error.set(null);
      });
    }
    const agent = this.outside(() => load(this.loadOptions)).then(
      (loaded) => {
        // Kept before anything reacts to the load, so that calls from then on reach the agent at once.
        this.loaded = loaded;
        return loaded;
      },
      (reason: unknown) => {
        throw toShieldLabsError(reason, 'load_failed', LOAD_FAILED);
      },
    );
    this.agent = agent;
    // The first reaction to the load: the status is 'ready' before the calls that waited continue.
    agent.then(
      () => {
        this.write(() => {
          this.status.set('ready');
          this.error.set(null);
        });
        this.startCheckOnLoad();
      },
      (reason: unknown) => {
        // Failed loads are not kept: the next call imports again.
        this.agent = undefined;
        const error = toShieldLabsError(reason, 'load_failed', LOAD_FAILED);
        this.write(() => {
          this.status.set('error');
          this.error.set(error);
        });
        this.warnAboutSetup(error);
      },
    );
    return agent;
  }

  /** An `identify()` or `check()` of the app, counted per User HID until it settles. */
  private run<T>(
    name: string,
    options: IdentifyOptions | undefined,
    call: (agent: ShieldLabsAgent, agentOptions: IdentifyOptions | undefined) => Promise<T>,
  ): Promise<T> {
    if (!this.isBrowser) return rejectOnServer(name);
    // Nothing may load before load() with autoLoad: false. Waiting could hold up a protected action
    // until its timeout, so the call fails at once and the action goes ahead as unverified.
    if (!this.allowed) return rejectBeforeLoad(name);
    let user: string | undefined;
    let promise: Promise<T>;
    try {
      user = userOf(options);
      promise = this.withAgent(options, call);
    } catch (reason) {
      // Options whose fields cannot be read (a getter that throws) reject like invalid options.
      return handledRejection(toShieldLabsError(reason, 'invalid_options', 'Could not read the options of ' + name + '.'));
    }
    // Counted before any reaction to the load can run, so checkOnLoad sees the call.
    this.count(user, 1);
    const settled = (): void => {
      this.count(user, -1);
    };
    promise.then(settled, settled);
    return promise;
  }

  /**
   * Calls the agent at once when it is loaded, with the options as they are. Otherwise the call waits
   * for the load within its timeout (its own, else the provider's, else 10 seconds) and then passes
   * the agent what is left of it: one deadline for the whole call.
   */
  private withAgent<T>(
    options: IdentifyOptions | undefined,
    call: (agent: ShieldLabsAgent, agentOptions: IdentifyOptions | undefined) => Promise<T>,
  ): Promise<T> {
    const loaded = this.loaded;
    if (loaded) return this.call(() => call(loaded, options));
    const given: unknown = options;
    const budget = isObject(given) && isTimeout(given.timeout) ? given.timeout : this.defaultTimeout;
    const startedAt = Date.now();
    return this.waitFor(this.ready(), budget).then((agent) => this.call(() => call(agent, withTimeLeft(options, budget, startedAt))));
  }

  /** Settles like `agent`, or rejects with `timeout` after `ms`. The load itself goes on. */
  private waitFor(agent: Promise<ShieldLabsAgent>, ms: number): Promise<ShieldLabsAgent> {
    // The timer runs outside the Angular zone, like the timers of the agent.
    return this.zone.runOutsideAngular(
      () =>
        new Promise<ShieldLabsAgent>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new ShieldLabsError('timeout', 'The ShieldLabs agent did not load within ' + String(ms) + ' ms.'));
          }, ms);
          agent.then(
            (loaded) => {
              clearTimeout(timer);
              resolve(loaded);
            },
            (reason: unknown) => {
              clearTimeout(timer);
              // Already a ShieldLabsError (see ready()); kept as it is.
              reject(toShieldLabsError(reason, 'load_failed', LOAD_FAILED));
            },
          );
        }),
    );
  }

  /** Runs `run` outside the Angular zone; a synchronous throw becomes a rejection. */
  private outside<T>(run: () => Promise<T>): Promise<T> {
    return this.zone.runOutsideAngular(
      () =>
        new Promise<T>((resolve) => {
          resolve(run());
        }),
    );
  }

  /** An agent call outside the Angular zone that always rejects with a `ShieldLabsError`. */
  private call<T>(run: () => Promise<T>): Promise<T> {
    return this.outside(run).catch((reason: unknown) => {
      throw toShieldLabsError(reason, 'not_initialized', 'The agent call failed.');
    });
  }

  private count(user: string | undefined, change: number): void {
    const calls = (this.running.get(user) ?? 0) + change;
    if (calls > 0) this.running.set(user, calls);
    else this.running.delete(user);
  }

  /**
   * What `getAgent()` resolves: the agent of `@shieldlabs/js` with its calls, and the listeners of
   * `identifyOnInteraction()`, outside the Angular zone like every call of this package. Anything else
   * the agent offers is inherited as it is. The same object for every `getAgent()`.
   */
  private expose(agent: ShieldLabsAgent): ShieldLabsAgent {
    if (this.exposed?.from !== agent) this.exposed = { from: agent, agent: this.outsideZone(agent) };
    return this.exposed.agent;
  }

  private outsideZone(agent: ShieldLabsAgent): ShieldLabsAgent {
    const outside = <T>(run: () => T): T => this.zone.runOutsideAngular(run);
    const identifyOnInteraction = (target: EventTarget, options?: IdentifyOptions): InteractionIdentifier => {
      const handle = outside(() => agent.identifyOnInteraction(target, options));
      // take() may start a new identification: its timer belongs outside the zone as well.
      return Object.freeze(
        Object.create(handle, { take: { enumerable: true, value: () => outside(() => handle.take()) } }) as InteractionIdentifier,
      );
    };
    return Object.freeze(
      Object.create(agent, {
        identify: { enumerable: true, value: (options?: IdentifyOptions) => outside(() => agent.identify(options)) },
        check: { enumerable: true, value: (options?: IdentifyOptions) => outside(() => agent.check(options)) },
        identifyOnInteraction: { enumerable: true, value: identifyOnInteraction },
      }) as ShieldLabsAgent,
    );
  }

  /**
   * A wrong Public Key or a page that is not a secure context fails every identification, and apps
   * often send the protected action anyway: say so once in the console during development.
   */
  private warnAboutSetup(error: ShieldLabsError): void {
    if (!isDevMode() || !SETUP_ERRORS.includes(error.code) || this.warned.has(error.code)) return;
    this.warned.add(error.code);
    console.warn('[ShieldLabs] Could not load the agent: ' + error.message);
  }

  /** Runs once, when the agent first becomes ready. */
  private startCheckOnLoad(): void {
    const options = this.checkOnLoad;
    const agent = this.loaded;
    if (!options || !agent || this.checked) return;
    this.checked = true;
    // The agent runs one identification at a time per user. A call of the app for the same user that
    // is still running covers this visit: do not compete with it. Calls for other users do not.
    if (this.running.has(options.userId)) return;
    this.call(() => agent.check(options)).catch((reason: unknown) => {
      if (isDevMode() && isShieldLabsError(reason) && reason.code === 'invalid_options') {
        console.warn('[ShieldLabs] checkOnLoad: ' + reason.message);
      }
    });
  }
}

/** The state of the closest `provideShieldLabs()`, or a clear error when there is none. */
export function injectState(call: string): ShieldLabsState {
  const state = inject(SHIELDLABS_STATE, { optional: true });
  if (!state) throw missingProvider(call);
  return state;
}
