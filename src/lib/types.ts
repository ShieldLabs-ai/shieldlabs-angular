import type { Signal } from '@angular/core';
import type { IdentifyOptions, IdentifyResult, LoadOptions, ShieldLabsAgent, ShieldLabsError } from '@shieldlabs-ai/js';

/** Options of {@link provideShieldLabs}: the `load()` options of `@shieldlabs-ai/js` plus `checkOnLoad` and `autoLoad`. */
export interface ShieldLabsOptions extends LoadOptions {
  /**
   * Runs `check()` once when the agent becomes ready, for passive monitoring of the visit. `true`
   * checks the visit without a user, `{ userId }` checks it for a signed-in user (User HID). Default
   * `false`. Skipped when an `identify()` or `check()` of the app for the same user is still running
   * at that moment.
   */
  checkOnLoad?: boolean | { userId?: string };
  /**
   * Loads the agent right after the first render in the browser (or on the first call, when that
   * comes earlier). Default `true`. With `false`, nothing loads until `load()` of
   * {@link injectShieldLabs} is called, for example once the visitor has given consent; until then
   * `identify()` fails at once with `not_initialized` (the one of `injectIdentify()` resolves
   * `null`), `check()` resolves `null` and `getAgent()` waits.
   */
  autoLoad?: boolean;
}

/** Load state of the agent: `'loading'` until the agent is imported, then `'ready'` or `'error'`. */
export type ShieldLabsStatus = 'loading' | 'ready' | 'error';

/** What {@link injectShieldLabs} returns: the agent state as signals plus the agent calls. */
export interface ShieldLabsRef {
  /**
   * `'loading'` until the agent is imported (also during server-side rendering, and before `load()`
   * with `autoLoad: false`), then `'ready'` or `'error'`.
   */
  readonly status: Signal<ShieldLabsStatus>;
  /** Why the agent could not be loaded, `null` otherwise. */
  readonly error: Signal<ShieldLabsError | null>;
  /**
   * Fresh identification now. Waits for the agent (and starts loading it if needed), then resolves
   * a new request ID. The `timeout` of the call covers the wait and the answer of the agent together.
   * Rejects with a `ShieldLabsError`: with `autoLoad: false`, at once with `not_initialized` until
   * `load()` is called.
   */
  identify(options?: IdentifyOptions): Promise<IdentifyResult>;
  /**
   * Background check, limited by the agent to one per visit every five minutes. Resolves `null`
   * when the agent skipped it, and at once with `autoLoad: false` until `load()` is called. Waits
   * for the agent like `identify()`. Rejects with a `ShieldLabsError`.
   */
  check(options?: IdentifyOptions): Promise<IdentifyResult | null>;
  /**
   * Starts loading the agent now: with `autoLoad: false`, the call that allows the agent to load,
   * for example after consent. Loads again after a failed load and does nothing while a load runs
   * or once the agent is ready. `status` and `error` report the result. Does nothing during
   * server-side rendering.
   */
  load(): void;
  /**
   * The loaded agent of `@shieldlabs-ai/js`, for example for `identifyOnInteraction()`. Starts loading
   * like `identify()`; with `autoLoad: false` it waits until `load()` is called. Its calls run outside
   * the Angular zone. Rejects with the `ShieldLabsError` of a failed load, and with
   * `unsupported_environment` during server-side rendering.
   */
  getAgent(): Promise<ShieldLabsAgent>;
}

/** Options of {@link injectIdentify}. */
export interface InjectIdentifyOptions {
  /**
   * User HID for every `identify()` call of this helper: a string, or a signal (or function) that is
   * read at call time. `null` or `undefined` means anonymous. Call options with a `userId` key
   * override it, also when the value is `undefined` or `null` (an anonymous call).
   */
  userId?: string | (() => string | null | undefined);
  /**
   * Calls `identify()` once after the component first renders in the browser. Every run is a
   * billable identification: use it only where a page view is the protected action. Default `false`.
   */
  runOnMount?: boolean;
}

/** What {@link injectIdentify} returns: an identify call with its result, loading and error state. */
export interface IdentifyRef {
  /** The latest identification of this helper: send `requestId` to your backend. `null` before and during a call. */
  readonly result: Signal<IdentifyResult | null>;
  /** `true` while an identification of this helper runs. */
  readonly isLoading: Signal<boolean>;
  /** Why the latest identification failed, `null` otherwise. */
  readonly error: Signal<ShieldLabsError | null>;
  /**
   * Runs a fresh identification and updates the signals. Resolves the result, or `null` when there
   * is no identification: it never rejects, and the reason is the `ShieldLabsError` in `error`. The
   * `timeout` of the call covers the wait for the agent and its answer together. While a call with
   * the same User HID and `timeout` is running, returns that call instead of starting another one
   * (for example on a double click): the agent runs one identification at a time per user. The User
   * HID of a call is its own `userId` when the options have that key (`undefined` and `null` both
   * mean anonymous), else the helper's. A call without `timeout` counts as one with the `timeout` of
   * the provider (10 seconds by default).
   */
  identify(options?: IdentifyOptions): Promise<IdentifyResult | null>;
  /** Clears `result`, `error` and `isLoading`. A call still running no longer updates the signals. */
  reset(): void;
}
