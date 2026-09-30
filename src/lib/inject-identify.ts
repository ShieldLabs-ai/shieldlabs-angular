import { afterNextRender, assertInInjectionContext, inject, Injector, signal, untracked } from '@angular/core';
import type { IdentifyOptions, IdentifyResult, ShieldLabsError } from '@shieldlabs/js';

import { toShieldLabsError } from './errors';
import { injectState } from './state';
import type { IdentifyRef, InjectIdentifyOptions } from './types';

/** A running call of a helper, shared with calls that have the same User HID and timeout. */
interface PendingCall {
  /** The number of the call. The signals show the outcome of the call whose number is `owner`. */
  readonly id: number;
  readonly userId: string | undefined;
  /** The timeout that bounds the call: its own, else the provider's (see `boundOf()`). */
  readonly timeout: unknown;
  readonly promise: Promise<IdentifyResult | null>;
}

function readUserId(value: InjectIdentifyOptions['userId']): string | undefined {
  // Read without tracking: calling identify() inside an effect must not make the effect depend on
  // the User HID signal (a changed User HID would otherwise start another identification).
  const userId = typeof value === 'function' ? untracked(value) : value;
  return userId ?? undefined;
}

/**
 * The timeout that bounds a call: its own `timeout`, else `fallback`, the timeout of the provider. As
 * in `@shieldlabs/js`, only an omitted timeout takes the fallback. Any other value stays as it is, so
 * an invalid one is never shared with a valid call and `@shieldlabs/js` still reports it.
 */
function boundOf(timeout: unknown, fallback: number): unknown {
  return timeout === undefined ? fallback : timeout;
}

/**
 * Per-call options with a `userId` key win over the helper's `userId`, whatever the value: an
 * explicit `userId: undefined`, or `null` from plain JavaScript, is an anonymous call. An anonymous
 * call carries no `userId`, so the agent gets `{}` and every anonymous call has the same User HID.
 */
function resolveOptions(defaults: InjectIdentifyOptions, callOptions: IdentifyOptions | undefined): IdentifyOptions {
  const resolved: IdentifyOptions = { ...callOptions };
  if (!callOptions || !('userId' in callOptions)) {
    const userId = readUserId(defaults.userId);
    if (userId !== undefined) resolved.userId = userId;
  }
  const effective: unknown = resolved.userId;
  if (effective === undefined || effective === null) delete resolved.userId;
  return resolved;
}

/**
 * An identify helper with `result`, `isLoading` and `error` signals, for a form or any other
 * protected action. Call it in an injection context, for example in a field initializer.
 *
 * `identify()` never rejects: it resolves `null` when there is no identification, and `error` holds
 * the reason, so the protected action can go ahead as unverified.
 *
 * ```ts
 * private readonly identification = injectIdentify();
 *
 * async submit() {
 *   const result = await this.identification.identify();
 *   // send result?.requestId ?? null to your backend with the protected action
 * }
 * ```
 */
export function injectIdentify(options: InjectIdentifyOptions = {}): IdentifyRef {
  assertInInjectionContext(injectIdentify);
  const state = injectState('injectIdentify()');
  const injector = inject(Injector);

  const result = signal<IdentifyResult | null>(null);
  const isLoading = signal(false);
  const error = signal<ShieldLabsError | null>(null);

  // The signals show the outcome of one call, the owner: the call asked for last, also when it
  // returned a running call. reset() and a call whose options cannot be read leave no call the
  // owner (0 is no call).
  let lastCall = 0;
  let owner = 0;
  /** The calls that have not settled yet. reset() forgets them, so later calls no longer share them. */
  let pending: PendingCall[] = [];

  /** Makes call `id` the owner: no result or error yet, and loading. */
  const follow = (id: number): void => {
    owner = id;
    state.write(() => {
      result.set(null);
      error.set(null);
      isLoading.set(true);
    });
  };

  const settle = (id: number, update: () => void): void => {
    pending = pending.filter((call) => call.id !== id);
    if (id !== owner) return;
    state.write(() => {
      update();
      isLoading.set(false);
    });
  };

  const identify = (callOptions?: IdentifyOptions): Promise<IdentifyResult | null> => {
    // During server-side rendering nothing is identified and the signals stay as they are, so that
    // the server HTML matches the first render in the browser.
    if (!state.isBrowser) return Promise.resolve(null);
    let resolved: IdentifyOptions;
    try {
      resolved = resolveOptions(options, callOptions);
    } catch (reason) {
      // A userId getter that throws: report it like any other failed call.
      const failure = toShieldLabsError(reason, 'invalid_options', 'Could not read the userId option.');
      owner = 0;
      state.write(() => {
        result.set(null);
        error.set(failure);
        isLoading.set(false);
      });
      return Promise.resolve(null);
    }
    const { userId } = resolved;
    // A call without a timeout of its own runs with the provider's, so it is the same call as one
    // that sets that timeout. The agent still gets the options as they are.
    const timeout = boundOf(resolved.timeout, state.defaultTimeout);
    // A call with the same User HID and timeout as a running one (a double click) shares it, also
    // when other calls started in between: the agent runs one identification at a time per user.
    const running = pending.find((call) => call.userId === userId && call.timeout === timeout);
    if (running) {
      // The signals follow the call that this one returns.
      if (owner !== running.id) follow(running.id);
      return running.promise;
    }

    const id = ++lastCall;
    follow(id);
    const promise = state.identify(resolved).then(
      (value) => {
        settle(id, () => {
          result.set(value);
        });
        return value;
      },
      (reason: unknown) => {
        settle(id, () => {
          error.set(toShieldLabsError(reason, 'not_initialized', 'The identification failed.'));
        });
        return null;
      },
    );
    pending.push({ id, userId, timeout, promise });
    return promise;
  };

  const reset = (): void => {
    owner = 0;
    pending = [];
    state.write(() => {
      result.set(null);
      error.set(null);
      isLoading.set(false);
    });
  };

  if (options.runOnMount === true && state.isBrowser) {
    // After the first render, in the browser only, once: never on later change detection runs.
    afterNextRender(
      () => {
        void identify();
      },
      { injector },
    );
  }

  return Object.freeze({
    result: result.asReadonly(),
    isLoading: isLoading.asReadonly(),
    error: error.asReadonly(),
    identify,
    reset,
  });
}
