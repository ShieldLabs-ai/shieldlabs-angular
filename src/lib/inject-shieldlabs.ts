import { assertInInjectionContext } from '@angular/core';

import { injectState } from './state';
import type { ShieldLabsRef } from './types';

/**
 * The agent of the closest `provideShieldLabs()`: its load `status` and `error` as signals, the
 * `identify()` and `check()` calls, `load()` to start loading (with `autoLoad: false`, for example
 * after consent) and `getAgent()` for the agent of `@shieldlabs/js` itself. Call it in an injection
 * context, for example in a field initializer of a component.
 *
 * ```ts
 * readonly shieldlabs = injectShieldLabs();
 * // template: @if (shieldlabs.status() === 'error') { ... }
 * ```
 */
export function injectShieldLabs(): ShieldLabsRef {
  assertInInjectionContext(injectShieldLabs);
  return injectState('injectShieldLabs()').ref;
}
