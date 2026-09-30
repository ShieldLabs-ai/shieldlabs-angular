/*
 * Public API of @shieldlabs/angular.
 */
export { provideShieldLabs } from './lib/provide-shieldlabs';
export { injectShieldLabs } from './lib/inject-shieldlabs';
export { injectIdentify } from './lib/inject-identify';
export type {
  IdentifyRef,
  InjectIdentifyOptions,
  ShieldLabsOptions,
  ShieldLabsRef,
  ShieldLabsStatus,
} from './lib/types';

// Re-exported from @shieldlabs/js (a peer dependency), so apps can import everything from here.
export { ShieldLabsError } from '@shieldlabs/js';
export type {
  IdentifyOptions,
  IdentifyResult,
  InteractionIdentifier,
  ShieldLabsAgent,
  ShieldLabsErrorCode,
} from '@shieldlabs/js';
