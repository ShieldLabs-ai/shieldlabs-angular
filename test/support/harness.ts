import { Component, type EnvironmentProviders, type Provider, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { load, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { vi } from 'vitest';

import { provideShieldLabs, type ShieldLabsOptions } from '../../src/public-api';
import { deferred, fakeAgent, flush, PUBLIC_KEY, type Deferred, type FakeAgent } from './fake-agent';

export interface Harness {
  agent: FakeAgent;
  loading: Deferred<ShieldLabsAgent>;
  /** Resolves the pending `load()` with the fake agent and waits for the callbacks. */
  ready(): Promise<void>;
  /**
   * Renders once, so that the provider starts loading as in an application, then resolves the load:
   * calls made after it reach the agent at once, with their options as they are.
   */
  loaded(): Promise<void>;
}

/** A component with an empty template, to make the application render once. */
export const EmptyHost = Component({ selector: 'sl-empty-host', standalone: true, template: '' })(
  class EmptyHost {},
);

/** Creates a component, runs change detection once and waits for the render hooks. */
export async function render<T>(component: Type<T>): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  await flush();
  return fixture;
}

/**
 * Configures TestBed with `provideShieldLabs()` and a `load()` mock (the test file mocks
 * `@shieldlabs-ai/js`) that resolves the fake agent once `ready()` is called.
 */
export function setup(
  options: Partial<ShieldLabsOptions> = {},
  providers: (Provider | EnvironmentProviders)[] = [],
): Harness {
  const agent = fakeAgent();
  const loading = deferred<ShieldLabsAgent>();
  vi.mocked(load).mockReturnValue(loading.promise);
  TestBed.configureTestingModule({
    providers: [provideShieldLabs({ publicKey: PUBLIC_KEY, ...options }), ...providers],
  });
  const ready = (): Promise<void> => {
    loading.resolve(agent);
    return flush();
  };
  return {
    agent,
    loading,
    ready,
    loaded: async () => {
      await render(EmptyHost);
      await ready();
    },
  };
}
