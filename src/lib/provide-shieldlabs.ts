import { ENVIRONMENT_INITIALIZER, inject, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';

import { SHIELDLABS_STATE, ShieldLabsState } from './state';
import type { ShieldLabsOptions } from './types';

/**
 * Sets up ShieldLabs for an application: add it to the `providers` of `bootstrapApplication` (or of
 * an NgModule). In the browser the agent is loaded once, after the first render (with
 * `autoLoad: false`, when `load()` of `injectShieldLabs()` is called); during server-side rendering
 * nothing is loaded.
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideShieldLabs({ publicKey: environment.shieldlabsPublicKey })],
 * });
 * ```
 */
export function provideShieldLabs(options: ShieldLabsOptions): EnvironmentProviders {
  const config: ShieldLabsOptions = { ...options };
  return makeEnvironmentProviders([
    { provide: SHIELDLABS_STATE, useFactory: () => new ShieldLabsState(config) },
    {
      // `provideEnvironmentInitializer()` exists only from Angular 19; this token works in 17 and later.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- needed for Angular 17 and 18
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        inject(SHIELDLABS_STATE).scheduleLoad();
      },
    },
  ]);
}
