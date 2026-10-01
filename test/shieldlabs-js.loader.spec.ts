import { Component, createEnvironmentInjector, EnvironmentInjector, NgZone, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs, provideShieldLabs, type ShieldLabsOptions, type ShieldLabsRef } from '../src/public-api';
import { EmptyHost, render } from './support/harness';

// Nothing is mocked in this file: provideShieldLabs() calls load() of the installed @shieldlabs-ai/js,
// which imports the agent URL with a native import(). The module hooks registered by
// test/setup/cdn-agent.mjs answer that import with test/support/cdn-agent.mjs, a stand-in for the
// hosted agent that records every import and call in this registry.

interface AgentCall {
  url: string;
  method: 'checkAnonymous' | 'checkAuthenticatedUser' | 'forceCheckAnonymous' | 'forceCheckAuthenticatedUser';
  userHid: string | undefined;
  options: unknown;
  zone: string | undefined;
}

interface TestAgent {
  /** Agent URLs imported so far, one entry per module evaluation. */
  imports: string[];
  calls: AgentCall[];
  /** How the stand-in answers the next calls. */
  answer: 'initialized' | 'not_initialized' | 'silent';
}

const agent: TestAgent = { imports: [], calls: [], answer: 'initialized' };
(globalThis as unknown as Record<string, unknown>)['__shieldlabsTestAgent'] = agent;

const CDN = 'https://cdn.shieldlabs.ai/snippet.js?publicKey=';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let keys = 0;

/**
 * Configures TestBed with a Public Key of its own: Node.js and @shieldlabs-ai/js keep every imported
 * agent URL for the rest of the file, so each test imports a fresh one.
 */
function configure(options: Partial<ShieldLabsOptions> = {}): string {
  keys += 1;
  const publicKey = '5b7d9f1a3c5e7a9b1d3f5a7c9e1b3d' + keys.toString(16).padStart(2, '0');
  TestBed.configureTestingModule({ providers: [provideShieldLabs({ publicKey, ...options })] });
  return publicKey;
}

/** The native import takes a moment: wait until the agent is loaded. */
async function whenReady(shieldlabs: ShieldLabsRef): Promise<void> {
  await vi.waitFor(
    () => {
      expect(shieldlabs.status()).toBe('ready');
    },
    { timeout: 5000 },
  );
}

beforeEach(() => {
  agent.imports.length = 0;
  agent.calls.length = 0;
  agent.answer = 'initialized';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('with the real @shieldlabs-ai/js loader', () => {
  it('imports the agent from the CDN once, after the first render, and identifies nothing by itself', async () => {
    const publicKey = configure();
    const Status = Component({ selector: 'sl-status', standalone: true, template: 'status: {{ shieldlabs.status() }}' })(
      class Status {
        readonly shieldlabs = injectShieldLabs();
      },
    );
    const fixture = TestBed.createComponent(Status);
    const { shieldlabs } = fixture.componentInstance;
    expect(agent.imports).toEqual([]);

    fixture.autoDetectChanges();
    await whenReady(shieldlabs);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('status: ready');
    expect(agent.imports).toEqual([CDN + publicKey]);

    // Later renders and a second provider with the same Public Key reuse the import.
    const child = createEnvironmentInjector([provideShieldLabs({ publicKey })], TestBed.inject(EnvironmentInjector));
    const childRef = runInInjectionContext(child, () => injectShieldLabs());
    await render(EmptyHost);
    await whenReady(childRef);
    expect(agent.imports).toEqual([CDN + publicKey]);
    expect(agent.calls).toEqual([]);
    child.destroy();
  });

  it('identify() runs the force call outside the Angular zone and resolves a new request ID each time', async () => {
    configure();
    const Form = Component({
      selector: 'sl-form',
      standalone: true,
      template: '{{ identification.result()?.requestId ?? "none" }}',
    })(
      class Form {
        readonly identification = injectIdentify();
      },
    );
    const fixture = await render(Form);
    const { identification } = fixture.componentInstance;
    const zone = TestBed.inject(NgZone);

    // Called from inside the Angular zone, like an event handler of a component.
    const first = (await zone.run(() => identification.identify()))!;
    const second = (await zone.run(() => identification.identify()))!;

    expect(first).toEqual({ requestId: expect.stringMatching(UUID) as string, userId: null });
    expect(second.requestId).toMatch(UUID);
    expect(second.requestId).not.toBe(first.requestId);
    expect(identification.result()).toEqual(second);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe(second.requestId);

    expect(agent.calls.map((call) => call.method)).toEqual(['forceCheckAnonymous', 'forceCheckAnonymous']);
    for (const call of agent.calls) {
      // The callback sits inside an options object: the agent ignores a bare function.
      expect(call.options).toEqual({ onInitialized: expect.any(Function) as unknown });
      expect(call.zone).not.toBe('angular');
    }
  });

  it('check() runs the non-force call, and a User HID selects the calls for signed-in users', async () => {
    configure();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify({ userId: 'hid_1' }));

    // No render in this test: the first call loads the agent.
    await expect(shieldlabs.check()).resolves.toEqual({ requestId: expect.stringMatching(UUID) as string, userId: null });
    await expect(shieldlabs.check({ userId: 'hid_2' })).resolves.toMatchObject({ userId: 'hid_2' });
    await expect(identification.identify()).resolves.toMatchObject({ userId: 'hid_1' });
    expect(agent.calls.map(({ method, userHid }) => [method, userHid])).toEqual([
      ['checkAnonymous', undefined],
      ['checkAuthenticatedUser', 'hid_2'],
      ['forceCheckAuthenticatedUser', 'hid_1'],
    ]);

    agent.answer = 'not_initialized';
    await expect(shieldlabs.check()).resolves.toBeNull();
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'not_initialized' });
    // The identify helper never rejects: it resolves null and shows the reason in error.
    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()?.code).toBe('not_initialized');
    expect(shieldlabs.status()).toBe('ready');
  });

  it('passes environment and timeout through to load() and the agent calls', async () => {
    const publicKey = configure({ environment: 'development', timeout: 1000 });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    await render(EmptyHost);
    await whenReady(shieldlabs);
    expect(agent.imports).toEqual(['https://dev.cdn.shieldlabs.ai/snippet.js?publicKey=' + publicKey]);

    // An agent that never answers: the timeout of the provider, then a per-call timeout.
    agent.answer = 'silent';
    await expect(shieldlabs.identify()).rejects.toMatchObject({
      code: 'timeout',
      message: 'The agent did not answer within 1000 ms.',
    });
    await expect(identification.identify({ timeout: 50 })).resolves.toBeNull();
    expect(identification.error()).toMatchObject({ code: 'timeout', message: 'The agent did not answer within 50 ms.' });
  });

  it('bounds a call that starts the load by one timeout, and the agent answers within what is left', async () => {
    configure();
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    agent.answer = 'silent';
    // No render: this call loads the agent, then waits for an answer that never comes.
    const startedAt = Date.now();
    await expect(identification.identify({ timeout: 500 })).resolves.toBeNull();
    const elapsed = Date.now() - startedAt;
    expect(agent.calls.map((call) => call.method)).toEqual(['forceCheckAnonymous']);
    // The agent got what was left of the 500 ms after the import, not another 500 ms.
    const prefix = 'The agent did not answer within ';
    const message = identification.error()?.message ?? '';
    expect(identification.error()?.code).toBe('timeout');
    expect(message.startsWith(prefix) && message.endsWith(' ms.')).toBe(true);
    const left = Number(message.slice(prefix.length, -' ms.'.length));
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(500);
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(1500);
  });

  it('passes scriptUrl through to load()', async () => {
    const publicKey = configure({ scriptUrl: 'https://localhost:4443/agent/snippet.js' });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    await whenReady(shieldlabs);
    expect(agent.imports).toEqual(['https://localhost:4443/agent/snippet.js?publicKey=' + publicKey]);
  });

  it('getAgent() gives the agent: identifyOnInteraction() identifies on the first interaction with a form', async () => {
    configure();
    const Signup = Component({
      selector: 'sl-signup',
      standalone: true,
      template: '<form><input name="email" /><button>Sign up</button></form>',
    })(
      class Signup {
        readonly shieldlabs = injectShieldLabs();
      },
    );
    const fixture = await render(Signup);
    const form = (fixture.nativeElement as HTMLElement).querySelector('form')!;
    const zone = TestBed.inject(NgZone);
    const loaded = await fixture.componentInstance.shieldlabs.getAgent();

    const early = zone.run(() => loaded.identifyOnInteraction(form));
    expect(agent.calls).toEqual([]);
    form.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(agent.calls.map((call) => call.method)).toEqual(['forceCheckAnonymous']);
    // The listeners were added outside the Angular zone, so the agent call runs outside it too.
    expect(agent.calls[0]?.zone).not.toBe('angular');

    const first = await zone.run(() => early.take());
    expect(first).toEqual({ requestId: expect.stringMatching(UUID) as string, userId: null });
    expect(agent.calls).toHaveLength(1);

    // take() re-arms: the next interaction starts the identification for the next submission.
    form.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const second = await zone.run(() => early.take());
    expect(second.requestId).not.toBe(first.requestId);
    expect(agent.calls).toHaveLength(2);

    early.dispose();
    form.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(agent.calls).toHaveLength(2);
  });

  it('autoLoad: false imports the agent only after load()', async () => {
    const publicKey = configure({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    await render(EmptyHost);
    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()?.code).toBe('not_initialized');
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'not_initialized' });
    // As check() of @shieldlabs-ai/js does for an agent that did not start a check.
    await expect(shieldlabs.check()).resolves.toBeNull();
    expect(agent.imports).toEqual([]);

    shieldlabs.load();
    await whenReady(shieldlabs);
    expect(agent.imports).toEqual([CDN + publicKey]);
    await expect(identification.identify()).resolves.toEqual({ requestId: expect.stringMatching(UUID) as string, userId: null });
  });

  it('shows an invalid Public Key as an error state and warns once in development mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({ providers: [provideShieldLabs({ publicKey: 'not a public key' })] });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    await vi.waitFor(() => {
      expect(shieldlabs.status()).toBe('error');
    });
    expect(shieldlabs.error()?.code).toBe('invalid_options');

    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'invalid_options' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[ShieldLabs] Could not load the agent: publicKey must match ^[A-Za-z0-9_-]{1,128}$ (the Public Key of your domain).',
    );
    expect(agent.imports).toEqual([]);
  });
});
