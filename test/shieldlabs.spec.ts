import { Component, ErrorHandler, NgZone, effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { load, ShieldLabsError, type IdentifyOptions, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs } from '../src/public-api';
import { deferred, fakeHandle, flush } from './support/fake-agent';
import { EmptyHost, render, setup } from './support/harness';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs-ai/js')>()),
  load: vi.fn(),
}));

function inject() {
  return TestBed.runInInjectionContext(() => injectShieldLabs());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('injectShieldLabs() state', () => {
  it('is loading, then ready once the agent is loaded', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    expect(shieldlabs.status()).toBe('loading');
    await harness.ready();
    expect(shieldlabs.status()).toBe('ready');
    expect(shieldlabs.error()).toBeNull();
  });

  it('returns the same object for every call in one injector, with read-only signals', () => {
    setup();
    const first = inject();
    const second = inject();
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect('set' in first.status).toBe(false);
    expect('set' in first.error).toBe(false);
  });

  it('shows a failed load as status error with the ShieldLabsError', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
    harness.loading.reject(failure);
    await flush();
    expect(shieldlabs.status()).toBe('error');
    expect(shieldlabs.error()).toBe(failure);
    await expect(shieldlabs.identify()).rejects.toBe(failure);
  });

  it('wraps an unexpected load failure in a load_failed ShieldLabsError', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    const cause = new TypeError('Failed to fetch dynamically imported module');
    harness.loading.reject(cause);
    await flush();
    const error = shieldlabs.error();
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error?.code).toBe('load_failed');
    expect(error?.cause).toBe(cause);
    expect(error?.message).toContain('Failed to fetch dynamically imported module');
  });

  it('wraps a synchronous throw of load() as well', async () => {
    setup();
    vi.mocked(load).mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw on purpose
      throw 'not an error';
    });
    const shieldlabs = inject();
    await render(EmptyHost);
    expect(shieldlabs.error()).toMatchObject({ code: 'load_failed', cause: 'not an error' });

    const error = await shieldlabs.identify().catch((reason: unknown) => reason);
    expect(load).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'load_failed', message: 'Could not load the ShieldLabs agent.', cause: 'not an error' });
    expect(shieldlabs.error()).toBe(error);
  });

  it('retries a failed load on the next call and becomes ready', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    harness.loading.reject(new ShieldLabsError('load_failed', 'offline'));
    await flush();
    expect(shieldlabs.status()).toBe('error');

    const retry = deferred<ShieldLabsAgent>();
    vi.mocked(load).mockReturnValue(retry.promise);
    const pending = shieldlabs.identify({ userId: 'hid_1' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();

    retry.resolve(harness.agent);
    await expect(pending).resolves.toMatchObject({ userId: 'hid_1' });
    expect(shieldlabs.status()).toBe('ready');
  });
});

describe('injectShieldLabs() calls', () => {
  it('identify() passes the options to the agent and resolves its result', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    harness.agent.identify.mockResolvedValueOnce({ requestId: '9b2d4f1e-8a6c-4e3b-b5d7-1f0e2c3a4b5c', userId: 'hid_1' });
    await expect(shieldlabs.identify({ userId: 'hid_1', timeout: 3000 })).resolves.toEqual({
      requestId: '9b2d4f1e-8a6c-4e3b-b5d7-1f0e2c3a4b5c',
      userId: 'hid_1',
    });
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1', timeout: 3000 });
  });

  it('identify() without options calls the loaded agent without options', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    await shieldlabs.identify();
    expect(harness.agent.identify).toHaveBeenCalledWith(undefined);
  });

  it('check() passes the options through and resolves the result or null', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    await expect(shieldlabs.check({ userId: 'hid_2' })).resolves.toMatchObject({ userId: 'hid_2' });
    expect(harness.agent.check).toHaveBeenCalledWith({ userId: 'hid_2' });
    harness.agent.check.mockResolvedValueOnce(null);
    await expect(shieldlabs.check()).resolves.toBeNull();
  });

  it('passes agent errors through and keeps the agent state ready', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    const timeout = new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.');
    harness.agent.identify.mockRejectedValueOnce(timeout);
    await expect(shieldlabs.identify()).rejects.toBe(timeout);
    harness.agent.check.mockRejectedValueOnce(new ShieldLabsError('invalid_options', 'bad'));
    await expect(shieldlabs.check({ userId: 'anonymous' })).rejects.toMatchObject({ code: 'invalid_options' });
    expect(shieldlabs.status()).toBe('ready');
    expect(shieldlabs.error()).toBeNull();
  });

  it('keeps a ShieldLabsError from another copy of @shieldlabs-ai/js as it is', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    const foreign = Object.assign(new Error('The agent did not answer within 10000 ms.'), {
      name: 'ShieldLabsError',
      code: 'timeout',
    });
    harness.agent.identify.mockRejectedValueOnce(foreign);
    await expect(shieldlabs.identify()).rejects.toBe(foreign);
  });

  it('turns a synchronous throw of the agent into a ShieldLabsError rejection', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    const failure = new Error('agent failure');
    harness.agent.identify.mockImplementationOnce(() => {
      throw failure;
    });
    const error = await shieldlabs.identify().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'not_initialized', message: 'The agent call failed. agent failure', cause: failure });
  });

  it('rejects with invalid_options instead of throwing when the options cannot be read', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const cause = new Error('getter failed');
    const options = Object.defineProperty({}, 'userId', {
      get() {
        throw cause;
      },
    }) as IdentifyOptions;
    const error = await shieldlabs.check(options).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'invalid_options', message: 'Could not read the options of check(). getter failed', cause });
    await harness.loaded();
    expect(harness.agent.check).not.toHaveBeenCalled();
  });

  it('does not end in an unhandled rejection when a failed call is ignored', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    // zone.js reports unhandled rejections through console.error.
    const consoleError = vi.spyOn(console, 'error');
    harness.agent.identify.mockRejectedValueOnce(new ShieldLabsError('timeout', 'late'));
    harness.agent.check.mockRejectedValueOnce(new ShieldLabsError('timeout', 'late'));
    void shieldlabs.identify();
    void shieldlabs.check();
    await flush();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('the timeout of a call that waits for the agent', () => {
  it('covers the wait and the answer: the agent gets the time that is left of the call timeout', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const pending = shieldlabs.identify({ userId: 'hid_1', timeout: 3000 });
    now.mockReturnValue(1_750);
    await harness.ready();
    await pending;
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1', timeout: 2250 });
  });

  it('is the provider timeout for a call without a timeout of its own', async () => {
    const harness = setup({ timeout: 5000 });
    const shieldlabs = inject();
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const pending = shieldlabs.check();
    now.mockReturnValue(1_200);
    await harness.ready();
    await pending;
    expect(harness.agent.check).toHaveBeenCalledWith({ timeout: 3800 });
  });

  it('is 10 seconds when neither the call nor the provider sets one', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const pending = shieldlabs.identify();
    now.mockReturnValue(2_500);
    await harness.ready();
    await pending;
    expect(harness.agent.identify).toHaveBeenCalledWith({ timeout: 7500 });
  });

  it('rejects with timeout when the agent does not load in time, and the load goes on', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await expect(shieldlabs.identify({ timeout: 20 })).rejects.toMatchObject({
      code: 'timeout',
      message: 'The ShieldLabs agent did not load within 20 ms.',
    });
    await expect(shieldlabs.check({ timeout: 10 })).rejects.toMatchObject({ code: 'timeout' });
    expect(shieldlabs.status()).toBe('loading');
    expect(load).toHaveBeenCalledTimes(1);

    await harness.ready();
    expect(shieldlabs.status()).toBe('ready');
    expect(harness.agent.identify).not.toHaveBeenCalled();
    expect(harness.agent.check).not.toHaveBeenCalled();
  });

  it('gives the agent at least 1 ms and never more than the call timeout', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const late = shieldlabs.identify({ timeout: 3000 });
    now.mockReturnValue(30_000);
    const back = shieldlabs.identify({ userId: 'hid_1', timeout: 3000 });
    // The agent arrives after the deadline of the first call (before its timer ran), and at a time
    // before the start of the second call (the clock went back).
    now.mockReturnValue(20_000);
    harness.loading.resolve(harness.agent);
    await Promise.all([late, back]);
    expect(harness.agent.identify).toHaveBeenNthCalledWith(1, { timeout: 1 });
    expect(harness.agent.identify).toHaveBeenNthCalledWith(2, { userId: 'hid_1', timeout: 3000 });
  });

  it('passes an invalid timeout and options that are not an object to the agent as they are', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const invalid = shieldlabs.identify({ timeout: -5 });
    const notAnObject = shieldlabs.check('hid_1' as unknown as IdentifyOptions);
    await harness.ready();
    await Promise.all([invalid, notAnObject]);
    // @shieldlabs-ai/js rejects both with invalid_options; the wait used the default timeout.
    expect(harness.agent.identify).toHaveBeenCalledWith({ timeout: -5 });
    expect(harness.agent.check).toHaveBeenCalledWith('hid_1');
  });

  it('does not apply once the agent is loaded: the options go to the agent as they are', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    await shieldlabs.identify({ timeout: 3000 });
    expect(harness.agent.identify).toHaveBeenCalledWith({ timeout: 3000 });
  });
});

describe('injectShieldLabs().getAgent()', () => {
  it('starts loading like a call and resolves the loaded agent, the same object every time', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const pending = shieldlabs.getAgent();
    expect(load).toHaveBeenCalledTimes(1);
    await harness.ready();
    const agent = await pending;
    await expect(shieldlabs.getAgent()).resolves.toBe(agent);
    expect(Object.isFrozen(agent)).toBe(true);
    expect(shieldlabs.status()).toBe('ready');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gives an agent whose calls go to the agent of @shieldlabs-ai/js outside the Angular zone', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    const zones: Record<string, boolean> = {};
    harness.agent.identify.mockImplementation((options?: IdentifyOptions) => {
      zones['identify'] = NgZone.isInAngularZone();
      return Promise.resolve({ requestId: '6a8c0e2b-4d6f-4a8c-9e0b-2d4f6a8c0e2d', userId: options?.userId ?? null });
    });
    harness.agent.check.mockImplementation(() => {
      zones['check'] = NgZone.isInAngularZone();
      return Promise.resolve(null);
    });
    const zone = TestBed.inject(NgZone);
    const agent = await shieldlabs.getAgent();

    await expect(zone.run(() => agent.identify({ userId: 'hid_1' }))).resolves.toMatchObject({ userId: 'hid_1' });
    await expect(zone.run(() => agent.check({ timeout: 2000 }))).resolves.toBeNull();
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1' });
    expect(harness.agent.check).toHaveBeenCalledWith({ timeout: 2000 });
    expect(zones).toEqual({ identify: false, check: false });
  });

  it('gives identifyOnInteraction() with its listeners and take() outside the Angular zone', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await harness.loaded();
    const handle = fakeHandle();
    const zones: Record<string, boolean> = {};
    harness.agent.identifyOnInteraction.mockImplementation(() => {
      zones['identifyOnInteraction'] = NgZone.isInAngularZone();
      return handle;
    });
    handle.take.mockImplementation(() => {
      zones['take'] = NgZone.isInAngularZone();
      return Promise.resolve({ requestId: '7b9d1f3a-5c7e-4b9d-8f1a-3c5e7b9d1f3a', userId: null });
    });
    const zone = TestBed.inject(NgZone);
    const agent = await shieldlabs.getAgent();
    const form = document.createElement('form');

    const early = zone.run(() => agent.identifyOnInteraction(form, { userId: 'hid_2' }));
    expect(harness.agent.identifyOnInteraction).toHaveBeenCalledWith(form, { userId: 'hid_2' });
    expect(Object.isFrozen(early)).toBe(true);
    await expect(zone.run(() => early.take())).resolves.toMatchObject({ requestId: '7b9d1f3a-5c7e-4b9d-8f1a-3c5e7b9d1f3a' });
    early.dispose();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(zones).toEqual({ identifyOnInteraction: false, take: false });
  });

  it('keeps everything else the agent offers', async () => {
    const harness = setup();
    const shieldlabs = inject();
    Object.assign(harness.agent, { laterMember: 'kept' });
    await harness.loaded();
    const agent = await shieldlabs.getAgent();
    expect((agent as unknown as Record<string, unknown>)['laterMember']).toBe('kept');
    expect(Object.keys(agent).sort()).toEqual(['check', 'identify', 'identifyOnInteraction']);
  });

  it('rejects with the load error without an unhandled rejection, and a later call loads again', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    const consoleError = vi.spyOn(console, 'error');
    const failure = new ShieldLabsError('load_failed', 'offline');
    const ignored = shieldlabs.getAgent();
    const awaited = shieldlabs.getAgent();
    harness.loading.reject(failure);
    await expect(awaited).rejects.toBe(failure);
    await flush();
    expect(consoleError).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('error');
    void ignored;

    vi.mocked(load).mockResolvedValue(harness.agent);
    await expect(shieldlabs.getAgent()).resolves.toMatchObject({ identify: expect.any(Function) as unknown });
    expect(load).toHaveBeenCalledTimes(2);
    expect(shieldlabs.status()).toBe('ready');
  });
});

describe('injectShieldLabs().load()', () => {
  it('starts loading before the first render and loads once', async () => {
    const harness = setup();
    const shieldlabs = inject();
    // load() returns nothing: status and error report the load. It also works taken off the object.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- load() does not depend on `this`
    const start: () => unknown = shieldlabs.load;
    expect(start()).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
    shieldlabs.load();
    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(1);
    await harness.ready();
    shieldlabs.load();
    expect(load).toHaveBeenCalledTimes(1);
    expect(shieldlabs.status()).toBe('ready');
  });

  it('loads again after a failed load', async () => {
    const harness = setup();
    const shieldlabs = inject();
    await render(EmptyHost);
    harness.loading.reject(new ShieldLabsError('load_failed', 'offline'));
    await flush();
    expect(shieldlabs.status()).toBe('error');

    const retry = deferred<ShieldLabsAgent>();
    vi.mocked(load).mockReturnValue(retry.promise);
    shieldlabs.load();
    expect(load).toHaveBeenCalledTimes(2);
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();
    retry.resolve(harness.agent);
    await flush();
    expect(shieldlabs.status()).toBe('ready');
  });
});

describe('Angular zone', () => {
  it('loads the agent and runs its calls outside the Angular zone', async () => {
    const harness = setup();
    const zones: Record<string, boolean> = {};
    vi.mocked(load).mockImplementation(() => {
      zones['load'] = NgZone.isInAngularZone();
      return Promise.resolve(harness.agent);
    });
    harness.agent.identify.mockImplementation(() => {
      zones['identify'] = NgZone.isInAngularZone();
      return Promise.resolve({ requestId: '5f0c6a2e-3b1d-4c8e-9a7f-2d4b6e8c0a1f', userId: null });
    });
    const zone = TestBed.inject(NgZone);
    const shieldlabs = inject();
    await zone.run(() => shieldlabs.identify());
    expect(zones).toEqual({ load: false, identify: false });
  });

  it('keeps the wait for the agent from holding up the stability of the app', async () => {
    const harness = setup();
    const shieldlabs = inject();
    const zone = TestBed.inject(NgZone);
    const pending = zone.run(() => shieldlabs.identify({ timeout: 60_000 }));
    // A timer of 60 seconds inside the Angular zone would keep whenStable() from resolving.
    const fixture = TestBed.createComponent(EmptyHost);
    await fixture.whenStable();
    await harness.ready();
    await pending;
  });

  it('updates templates of a zone-based app when the agent becomes ready', async () => {
    const harness = setup();
    const Status = Component({ selector: 'sl-status', standalone: true, template: 'status: {{ shieldlabs.status() }}' })(
      class Status {
        readonly shieldlabs = injectShieldLabs();
      },
    );
    const fixture = TestBed.createComponent(Status);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('status: loading');
    await harness.ready();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('status: ready');
  });

  it('can be called from an effect without a signal write error', async () => {
    const errors: unknown[] = [];
    const harness = setup({}, [{ provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } }]);
    await harness.loaded();
    const Caller = Component({ selector: 'sl-caller', standalone: true, template: '' })(
      class Caller {
        readonly shieldlabs = injectShieldLabs();
        constructor() {
          effect(() => {
            void this.shieldlabs.identify().catch(() => undefined);
          });
        }
      },
    );
    await render(Caller);
    await flush();
    expect(errors).toEqual([]);
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
  });
});

describe('checkOnLoad', () => {
  it('is off by default', async () => {
    const harness = setup();
    await harness.loaded();
    expect(harness.agent.check).not.toHaveBeenCalled();
  });

  it('true runs one anonymous check() when the agent is ready', async () => {
    const harness = setup({ checkOnLoad: true });
    await render(EmptyHost);
    expect(harness.agent.check).not.toHaveBeenCalled();
    await harness.ready();
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith({});
  });

  it('{ userId } checks the visit for that user', async () => {
    const harness = setup({ checkOnLoad: { userId: 'hid_3' } });
    await harness.loaded();
    expect(harness.agent.check).toHaveBeenCalledWith({ userId: 'hid_3' });
  });

  it('{} without a userId checks the visit anonymously', async () => {
    const harness = setup({ checkOnLoad: {} });
    await harness.loaded();
    expect(harness.agent.check).toHaveBeenCalledWith({});
  });

  it('runs once, when a failed load is retried later', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    await render(EmptyHost);
    harness.loading.reject(new ShieldLabsError('load_failed', 'offline'));
    await flush();
    expect(harness.agent.check).not.toHaveBeenCalled();

    vi.mocked(load).mockResolvedValue(harness.agent);
    await shieldlabs.identify({ userId: 'hid_4' });
    await flush();
    // The call of the app is for another user, so the anonymous background check runs as well.
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith({});

    await shieldlabs.identify({ userId: 'hid_4' });
    await flush();
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed load by itself: the next call does', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    await render(EmptyHost);
    harness.loading.reject(new ShieldLabsError('load_failed', 'offline'));
    await flush();
    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(1);

    vi.mocked(load).mockResolvedValue(harness.agent);
    await shieldlabs.identify();
    expect(load).toHaveBeenCalledTimes(2);
    expect(shieldlabs.status()).toBe('ready');
  });

  it('is skipped while an identify() for the same user is in flight when the agent becomes ready', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    const pending = shieldlabs.identify();
    await harness.ready();
    await pending;
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).not.toHaveBeenCalled();

    // It stays done: calls after that do not bring it back.
    await render(EmptyHost);
    expect(harness.agent.check).not.toHaveBeenCalled();
  });

  it('is skipped while a check() for the same User HID is in flight when the agent becomes ready', async () => {
    const harness = setup({ checkOnLoad: { userId: 'hid_3' } });
    const shieldlabs = inject();
    const pending = shieldlabs.check({ userId: 'hid_3' });
    await harness.ready();
    await pending;
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith(expect.objectContaining({ userId: 'hid_3' }));
  });

  it('is skipped while an injectIdentify() call for the same user is in flight', async () => {
    const harness = setup({ checkOnLoad: { userId: 'hid_3' } });
    const identification = TestBed.runInInjectionContext(() => injectIdentify({ userId: 'hid_3' }));
    const pending = identification.identify();
    await harness.ready();
    await pending;
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).not.toHaveBeenCalled();
  });

  it('runs when the call for the same user already timed out before the agent became ready', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    await expect(shieldlabs.identify({ timeout: 10 })).rejects.toMatchObject({ code: 'timeout' });
    await harness.loaded();
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith({});
  });

  it('still runs when the app called identify() for another user before the agent was ready', async () => {
    const harness = setup({ checkOnLoad: { userId: 'hid_3' } });
    const shieldlabs = inject();
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    const pending = Promise.all([shieldlabs.identify({ userId: 'hid_5' }), identification.identify()]);
    await harness.ready();
    await pending;
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith({ userId: 'hid_3' });
  });

  it('is not affected by calls made after the agent was ready', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    await harness.loaded();
    await shieldlabs.check();
    expect(harness.agent.check).toHaveBeenCalledTimes(2);
    expect(harness.agent.check).toHaveBeenNthCalledWith(1, {});
    expect(harness.agent.check).toHaveBeenNthCalledWith(2, undefined);
  });

  it('swallows a failed background check and keeps the state ready', async () => {
    const harness = setup({ checkOnLoad: true });
    const shieldlabs = inject();
    harness.agent.check.mockRejectedValueOnce(new ShieldLabsError('timeout', 'late'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await harness.loaded();
    expect(shieldlabs.status()).toBe('ready');
    expect(shieldlabs.error()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns in development mode when the checkOnLoad options are invalid', async () => {
    const harness = setup({ checkOnLoad: { userId: 'anonymous' } });
    harness.agent.check.mockRejectedValueOnce(new ShieldLabsError('invalid_options', 'userId "anonymous" is reserved.'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await harness.loaded();
    await flush();
    expect(warn).toHaveBeenCalledWith('[ShieldLabs] checkOnLoad: userId "anonymous" is reserved.');
  });
});
