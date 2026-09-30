import { ShieldLabsError, type ShieldLabsErrorCode } from '@shieldlabs/js';

function noop(): void {
  // Handled here so that an ignored promise cannot end in an unhandled rejection.
}

/** `instanceof`, plus a shape check in case an app ends up with two copies of `@shieldlabs/js`. */
export function isShieldLabsError(value: unknown): value is ShieldLabsError {
  if (value instanceof ShieldLabsError) return true;
  return value instanceof Error && value.name === 'ShieldLabsError' && typeof (value as { code?: unknown }).code === 'string';
}

/** Keeps a `ShieldLabsError` as it is and wraps anything else, so the error signals always hold one. */
export function toShieldLabsError(reason: unknown, code: ShieldLabsErrorCode, message: string): ShieldLabsError {
  if (isShieldLabsError(reason)) return reason;
  return new ShieldLabsError(code, reason instanceof Error && reason.message ? message + ' ' + reason.message : message, reason);
}

/** Marks `promise` as handled and returns it: callers that await it still get its rejection. */
export function handled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(noop);
  return promise;
}

/** A rejected promise that is already marked as handled: callers that await it still get the error. */
export function handledRejection(error: ShieldLabsError): Promise<never> {
  return handled(Promise.reject(error));
}

/**
 * The rejection of every agent call made during server-side rendering. An ignored call must not end
 * in an unhandled rejection, which can stop a Node.js server process.
 */
export function rejectOnServer(call: string): Promise<never> {
  return handledRejection(
    new ShieldLabsError(
      'unsupported_environment',
      call + ' runs in the browser only: the ShieldLabs agent is not loaded during server-side rendering.',
    ),
  );
}

/**
 * The rejection of an `identify()` made with `autoLoad: false` before `load()` allowed the agent to
 * load. A `check()` made then resolves `null` instead.
 */
export function rejectBeforeLoad(call: string): Promise<never> {
  return handledRejection(
    new ShieldLabsError(
      'not_initialized',
      call + ' needs the agent, which is not loaded: with autoLoad: false, call load() of injectShieldLabs() first.',
    ),
  );
}

/** Thrown by the inject functions when `provideShieldLabs()` is missing. */
export function missingProvider(call: string): ShieldLabsError {
  return new ShieldLabsError(
    'invalid_options',
    call + ' needs provideShieldLabs({ publicKey }) in the providers of your application (bootstrapApplication or an NgModule).',
  );
}
