import type { IdentifyOptions, IdentifyResult, InteractionIdentifier, ShieldLabsAgent } from '@shieldlabs-ai/js';
import { vi, type Mock } from 'vitest';

/** A placeholder Public Key in the issued format (32 lowercase hex characters). */
export const PUBLIC_KEY = '0123456789abcdef0123456789abcdef';

let counter = 0;

/** Deterministic UUIDv4-shaped request IDs. */
export function nextRequestId(): string {
  counter += 1;
  return '7c9e6679-7425-40de-944b-' + counter.toString(16).padStart(12, '0');
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeAgent extends ShieldLabsAgent {
  identify: Mock<(options?: IdentifyOptions) => Promise<IdentifyResult>>;
  check: Mock<(options?: IdentifyOptions) => Promise<IdentifyResult | null>>;
  identifyOnInteraction: Mock<ShieldLabsAgent['identifyOnInteraction']>;
}

function answer(options?: IdentifyOptions): IdentifyResult {
  return { requestId: nextRequestId(), userId: options?.userId ?? null };
}

/** A stand-in for the agent that `load()` of `@shieldlabs-ai/js` resolves. */
export function fakeAgent(): FakeAgent {
  return {
    identify: vi.fn((options?: IdentifyOptions) => Promise.resolve(answer(options))),
    check: vi.fn((options?: IdentifyOptions) => Promise.resolve<IdentifyResult | null>(answer(options))),
    identifyOnInteraction: vi.fn<ShieldLabsAgent['identifyOnInteraction']>(),
  };
}

export interface FakeHandle extends InteractionIdentifier {
  take: Mock<() => Promise<IdentifyResult>>;
  dispose: Mock<() => void>;
}

/** A stand-in for the handle that `identifyOnInteraction()` of the agent returns. */
export function fakeHandle(): FakeHandle {
  return {
    take: vi.fn(() => Promise.resolve(answer())),
    dispose: vi.fn(),
  };
}

/** Waits until pending promise callbacks (and zone.js microtasks) have run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
