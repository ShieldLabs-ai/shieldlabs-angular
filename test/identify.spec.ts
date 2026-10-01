import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { load, ShieldLabsError, type IdentifyResult } from '@shieldlabs-ai/js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs, type InjectIdentifyOptions } from '../src/public-api';
import { deferred, flush } from './support/fake-agent';
import { render, setup } from './support/harness';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs-ai/js')>()),
  load: vi.fn(),
}));

function inject(options?: InjectIdentifyOptions) {
  return TestBed.runInInjectionContext(() => injectIdentify(options));
}

const RESULT: IdentifyResult = { requestId: '2c5ea4c0-4067-4b1a-9d3e-6f8a0b2c4d6e', userId: null };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('injectIdentify()', () => {
  it('starts empty', () => {
    setup();
    const identification = inject();
    expect(identification.result()).toBeNull();
    expect(identification.isLoading()).toBe(false);
    expect(identification.error()).toBeNull();
    expect(Object.isFrozen(identification)).toBe(true);
  });

  it('identify() sets isLoading right away, then the result', async () => {
    const harness = setup();
    const identification = inject();
    harness.agent.identify.mockResolvedValueOnce(RESULT);

    const pending = identification.identify();
    expect(identification.isLoading()).toBe(true);
    expect(identification.result()).toBeNull();

    await harness.ready();
    await expect(pending).resolves.toEqual(RESULT);
    expect(identification.result()).toEqual(RESULT);
    expect(identification.isLoading()).toBe(false);
    expect(identification.error()).toBeNull();
  });

  it('identifies anonymously by default', async () => {
    const harness = setup();
    await harness.loaded();
    await inject().identify();
    expect(harness.agent.identify).toHaveBeenCalledWith({});
  });

  it('uses the userId option', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });
    await expect(identification.identify()).resolves.toMatchObject({ userId: 'hid_1' });
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1' });
  });

  it('reads a userId signal at call time', async () => {
    const harness = setup();
    await harness.loaded();
    const userHid = signal<string | null>(null);
    const identification = inject({ userId: userHid });

    await identification.identify();
    expect(harness.agent.identify).toHaveBeenLastCalledWith({});

    userHid.set('hid_2');
    await identification.identify();
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ userId: 'hid_2' });
  });

  it('accepts a plain function as userId', async () => {
    const harness = setup();
    await harness.loaded();
    await inject({ userId: () => 'hid_3' }).identify();
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_3' });
  });

  it('lets per-call options win, including an explicit anonymous call', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });

    await identification.identify({ userId: 'hid_4', timeout: 3000 });
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ userId: 'hid_4', timeout: 3000 });

    await identification.identify({ timeout: 2000 });
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ userId: 'hid_1', timeout: 2000 });

    await identification.identify({ userId: undefined });
    expect(harness.agent.identify).toHaveBeenLastCalledWith({});

    // null from plain JavaScript is anonymous as well, and no null reaches the agent.
    const withNull = identification.identify({ userId: null as unknown as string, timeout: 2000 });
    await expect(withNull).resolves.toMatchObject({ userId: null });
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ timeout: 2000 });

    // Only options without the key use the helper's userId.
    await identification.identify({});
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ userId: 'hid_1' });
  });

  it('resolves null instead of rejecting and shows the ShieldLabsError in error', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const failure = new ShieldLabsError('not_initialized', 'The agent did not start an identification.');
    harness.agent.identify.mockRejectedValueOnce(failure);

    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()).toBe(failure);
    expect(identification.isLoading()).toBe(false);
    expect(identification.result()).toBeNull();
  });

  it('does not cause an unhandled rejection when the caller ignores the promise', async () => {
    const harness = setup();
    await harness.loaded();
    // zone.js reports unhandled rejections through console.error.
    const consoleError = vi.spyOn(console, 'error');
    const identification = inject();
    harness.agent.identify.mockRejectedValueOnce(new ShieldLabsError('timeout', 'late'));

    void identification.identify();
    await flush();
    expect(identification.error()?.code).toBe('timeout');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('resolves null and shows a failed agent load in error', async () => {
    const harness = setup();
    const identification = inject();
    const pending = identification.identify();
    harness.loading.reject(new ShieldLabsError('load_failed', 'blocked by a content blocker'));
    await expect(pending).resolves.toBeNull();
    expect(identification.error()?.code).toBe('load_failed');
    expect(identification.isLoading()).toBe(false);
  });

  it('resolves null with a timeout error when the agent does not load within the call timeout', async () => {
    const harness = setup();
    const identification = inject();
    await expect(identification.identify({ timeout: 20 })).resolves.toBeNull();
    expect(identification.error()).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 20 ms.' });
    expect(identification.isLoading()).toBe(false);
    expect(harness.agent.identify).not.toHaveBeenCalled();
  });

  it('gives a call that waits for the agent one timeout: the agent gets the time that is left', async () => {
    const harness = setup();
    const identification = inject({ userId: 'hid_1' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const pending = identification.identify({ timeout: 4000 });
    now.mockReturnValue(6_500);
    await harness.ready();
    await expect(pending).resolves.toMatchObject({ userId: 'hid_1' });
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1', timeout: 2500 });
  });

  it('clears the previous result and error when a new call starts', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();

    harness.agent.identify.mockRejectedValueOnce(new ShieldLabsError('timeout', 'late'));
    await identification.identify();
    expect(identification.error()).not.toBeNull();

    const next = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(next.promise);
    const pending = identification.identify();
    expect(identification.error()).toBeNull();
    expect(identification.isLoading()).toBe(true);
    next.resolve(RESULT);
    await pending;
    expect(identification.result()).toEqual(RESULT);

    const third = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(third.promise);
    const again = identification.identify();
    expect(identification.result()).toBeNull();
    third.resolve({ ...RESULT, requestId: '8d0f2b4a-6c8e-4a0b-b2d4-6f8a0c2e4b6d' });
    await again;
    expect(identification.result()?.requestId).toBe('8d0f2b4a-6c8e-4a0b-b2d4-6f8a0c2e4b6d');
  });

  it('returns a running call with the same userId and timeout instead of starting another (double click)', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify({ timeout: 5000 });
    await flush();
    const second = identification.identify({ timeout: 5000 });
    expect(second).toBe(first);
    running.resolve({ ...RESULT, userId: 'hid_1' });
    await Promise.all([first, second]);
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);

    await identification.identify({ timeout: 5000 });
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('shares a running call that failed as well: both callers get null', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify();
    const second = identification.identify();
    running.reject(new ShieldLabsError('not_initialized', 'The agent did not start an identification.'));
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(identification.error()?.code).toBe('not_initialized');
  });

  it('shares on the effective User HID: userId undefined or null in the call is an anonymous call', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });
    harness.agent.identify.mockReturnValue(new Promise<IdentifyResult>(() => undefined));

    const forUser = identification.identify();
    const anonymous = identification.identify({ userId: undefined });
    // The call overrides the helper's userId: an anonymous identification, not the running one.
    expect(anonymous).not.toBe(forUser);
    expect(identification.identify({ userId: null as unknown as string })).toBe(anonymous);
    expect(identification.identify({})).toBe(forUser);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(harness.agent.identify).toHaveBeenNthCalledWith(1, { userId: 'hid_1' });
    expect(harness.agent.identify).toHaveBeenNthCalledWith(2, {});

    // In a helper without a userId, identify() is an anonymous call too.
    const withoutUser = inject();
    const first = withoutUser.identify();
    expect(withoutUser.identify({ userId: null as unknown as string })).toBe(first);
    expect(harness.agent.identify).toHaveBeenCalledTimes(3);
  });

  it('shares calls within one helper only: another helper starts its own identification', async () => {
    const harness = setup();
    await harness.loaded();
    const checkout = inject({ userId: 'hid_1' });
    const payment = inject({ userId: 'hid_1' });
    harness.agent.identify.mockReturnValue(new Promise<IdentifyResult>(() => undefined));

    const fromCheckout = checkout.identify();
    const fromPayment = payment.identify();
    expect(fromPayment).not.toBe(fromCheckout);
    // Within one helper, a double click still shares.
    expect(checkout.identify()).toBe(fromCheckout);
    expect(payment.identify()).toBe(fromPayment);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(checkout.isLoading()).toBe(true);
    expect(payment.isLoading()).toBe(true);
  });

  it('starts a separate call for the same user with another timeout', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify();
    const second = identification.identify({ timeout: 3000 });
    expect(second).not.toBe(first);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(harness.agent.identify).toHaveBeenNthCalledWith(1, { userId: 'hid_1' });
    expect(harness.agent.identify).toHaveBeenNthCalledWith(2, { userId: 'hid_1', timeout: 3000 });
    running.resolve({ ...RESULT, userId: 'hid_1' });
    await Promise.all([first, second]);
  });

  it('counts a call without a timeout as one with the default timeout of 10 seconds', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject({ userId: 'hid_1' });
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify();
    expect(identification.identify({ timeout: 10000 })).toBe(first);
    expect(identification.identify({ userId: 'hid_1', timeout: 10000 })).toBe(first);
    running.resolve({ ...RESULT, userId: 'hid_1' });
    await expect(first).resolves.toMatchObject({ userId: 'hid_1' });
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    // What the agent receives does not change: an omitted timeout stays omitted.
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1' });
  });

  it('counts a call without a timeout as one with the timeout of the provider', async () => {
    const harness = setup({ timeout: 4000 });
    await harness.loaded();
    const identification = inject();
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify({ timeout: 4000 });
    expect(identification.identify()).toBe(first);
    // 10 seconds is not the timeout of this provider: another identification.
    const other = identification.identify({ timeout: 10000 });
    expect(other).not.toBe(first);
    running.resolve(RESULT);
    await Promise.all([first, other]);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(harness.agent.identify).toHaveBeenNthCalledWith(1, { timeout: 4000 });
    expect(harness.agent.identify).toHaveBeenNthCalledWith(2, { timeout: 10000 });
  });

  it('never shares a call with a timeout that @shieldlabs-ai/js refuses', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify();
    const invalid = identification.identify({ timeout: null as unknown as number });
    expect(invalid).not.toBe(first);
    expect(harness.agent.identify).toHaveBeenLastCalledWith({ timeout: null });
    running.resolve(RESULT);
    await Promise.all([first, invalid]);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('starts a separate call for a different user and keeps the latest one in the signals', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const first = deferred<IdentifyResult>();
    const second = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = identification.identify({ userId: 'hid_a' });
    await flush();
    const b = identification.identify({ userId: 'hid_b' });
    expect(b).not.toBe(a);

    second.resolve({ requestId: '1a3c5e7b-9d1f-4b3d-8f5a-7c9e1b3d5f7a', userId: 'hid_b' });
    await b;
    first.resolve({ requestId: '0b2d4f6a-8c0e-4a2c-9e4b-6d8f0a2c4e6b', userId: 'hid_a' });
    await a;
    expect(identification.result()?.userId).toBe('hid_b');
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('returns a running call with the same userId also when another call started after it, and the signals follow it', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const first = deferred<IdentifyResult>();
    const second = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const a = identification.identify({ userId: 'hid_a' });
    const b = identification.identify({ userId: 'hid_b' });
    // The call for hid_a still runs, and the agent would refuse a second one for that user.
    const again = identification.identify({ userId: 'hid_a' });
    expect(again).toBe(a);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(identification.isLoading()).toBe(true);

    second.resolve({ requestId: '1a3c5e7b-9d1f-4b3d-8f5a-7c9e1b3d5f7a', userId: 'hid_b' });
    await expect(b).resolves.toMatchObject({ userId: 'hid_b' });
    // The signals follow the call asked for last, which is the one for hid_a.
    expect(identification.result()).toBeNull();
    expect(identification.isLoading()).toBe(true);

    first.resolve({ requestId: '0b2d4f6a-8c0e-4a2c-9e4b-6d8f0a2c4e6b', userId: 'hid_a' });
    await expect(again).resolves.toMatchObject({ userId: 'hid_a' });
    expect(identification.result()?.userId).toBe('hid_a');
    expect(identification.isLoading()).toBe(false);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('shares a running call after a call whose userId could not be read', async () => {
    const harness = setup();
    await harness.loaded();
    let broken = false;
    const identification = inject({
      userId: () => {
        if (broken) throw new Error('session not ready');
        return 'hid_1';
      },
    });
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const first = identification.identify();
    broken = true;
    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()?.code).toBe('invalid_options');
    expect(identification.isLoading()).toBe(false);

    // The same call again: it gets the running identification, and the signals follow it.
    const again = identification.identify({ userId: 'hid_1' });
    expect(again).toBe(first);
    expect(identification.error()).toBeNull();
    expect(identification.isLoading()).toBe(true);
    running.resolve({ ...RESULT, userId: 'hid_1' });
    await again;
    expect(identification.result()?.userId).toBe('hid_1');
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
  });

  it('reset() clears the state and ignores a call that is still running', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const running = deferred<IdentifyResult>();
    harness.agent.identify.mockReturnValueOnce(running.promise);

    const pending = identification.identify();
    identification.reset();
    expect(identification.isLoading()).toBe(false);
    running.resolve(RESULT);
    await expect(pending).resolves.toEqual(RESULT);
    expect(identification.result()).toBeNull();

    const next = identification.identify();
    expect(next).not.toBe(pending);
    await next;
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(identification.result()).not.toBeNull();

    identification.reset();
    expect(identification.result()).toBeNull();
    expect(identification.error()).toBeNull();
  });

  it('reports a userId getter that throws as invalid_options and resolves null', async () => {
    const harness = setup();
    await harness.loaded();
    const cause = new Error('session not ready');
    const identification = inject({
      userId: () => {
        throw cause;
      },
    });
    await expect(identification.identify()).resolves.toBeNull();
    const error = identification.error();
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'invalid_options', cause });
    expect(identification.isLoading()).toBe(false);
    expect(harness.agent.identify).not.toHaveBeenCalled();

    void identification.identify();
    await flush();
    await expect(identification.identify({ userId: 'hid_5' })).resolves.toMatchObject({ userId: 'hid_5' });
    expect(identification.error()).toBeNull();
  });

  it('wraps an unexpected failure in a ShieldLabsError', async () => {
    const harness = setup();
    await harness.loaded();
    const identification = inject();
    const cause = new Error('boom');
    harness.agent.identify.mockRejectedValueOnce(cause);
    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()).toBeInstanceOf(ShieldLabsError);
    expect(identification.error()).toMatchObject({ code: 'not_initialized', cause });
  });

  it('goes through the provider, so a load started by the helper is shared with injectShieldLabs()', async () => {
    const harness = setup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = inject();
    const pending = identification.identify();
    expect(shieldlabs.status()).toBe('loading');
    await harness.ready();
    await pending;
    expect(shieldlabs.status()).toBe('ready');
  });
});

describe('injectIdentify({ runOnMount })', () => {
  const OnMount = Component({
    selector: 'sl-on-mount',
    standalone: true,
    template: '{{ identification.isLoading() }} {{ identification.result()?.requestId ?? "none" }}',
  })(
    class OnMount {
      readonly identification = injectIdentify({ runOnMount: true, userId: 'hid_1' });
    },
  );

  it('identifies once after the first render, never on later change detection', async () => {
    const harness = setup();
    await harness.loaded();
    harness.agent.identify.mockResolvedValue({ ...RESULT, userId: 'hid_1' });

    // Construction itself runs nothing (see the test below); TestBed may run the render hooks on the
    // tick that follows createComponent().
    const fixture = TestBed.createComponent(OnMount);
    fixture.detectChanges();
    await fixture.whenStable();
    await flush();
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(harness.agent.identify).toHaveBeenCalledWith({ userId: 'hid_1' });

    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await flush();
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('false ' + RESULT.requestId);
  });

  it('waits for the agent when it is not loaded yet', async () => {
    const harness = setup();
    const fixture = await render(OnMount);
    expect(fixture.componentInstance.identification.isLoading()).toBe(true);
    expect(harness.agent.identify).not.toHaveBeenCalled();
    await harness.ready();
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.identification.result()).not.toBeNull();
  });

  it('with autoLoad: false before load(), ends at once with not_initialized and does not run again after load()', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const fixture = await render(OnMount);
    const identification = fixture.componentInstance.identification;
    // Like identify() before load(): null with not_initialized, without waiting and without loading.
    expect(identification.error()).toBeInstanceOf(ShieldLabsError);
    expect(identification.error()?.code).toBe('not_initialized');
    expect(identification.isLoading()).toBe(false);
    expect(identification.result()).toBeNull();
    expect(load).not.toHaveBeenCalled();

    shieldlabs.load();
    await harness.ready();
    fixture.detectChanges();
    await flush();
    expect(shieldlabs.status()).toBe('ready');
    expect(harness.agent.identify).not.toHaveBeenCalled();
    expect(identification.error()?.code).toBe('not_initialized');
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('false none');
  });

  it('with autoLoad: false, waits for the agent when load() was called before the first render', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    shieldlabs.load();
    const fixture = await render(OnMount);
    const identification = fixture.componentInstance.identification;
    expect(identification.isLoading()).toBe(true);
    expect(harness.agent.identify).not.toHaveBeenCalled();

    await harness.ready();
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(identification.result()).toMatchObject({ userId: 'hid_1' });
    expect(identification.error()).toBeNull();
  });

  it('shows a failed load in error without an unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const harness = setup();
    const fixture = await render(OnMount);
    harness.loading.reject(new ShieldLabsError('load_failed', 'offline'));
    await flush();
    expect(fixture.componentInstance.identification.error()?.code).toBe('load_failed');
    expect(fixture.componentInstance.identification.isLoading()).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('runs nothing while the component is constructed', async () => {
    const harness = setup();
    await harness.loaded();
    let loadingInConstructor: boolean | undefined;
    const Probe = Component({ selector: 'sl-probe', standalone: true, template: '' })(
      class Probe {
        readonly identification = injectIdentify({ runOnMount: true });
        constructor() {
          loadingInConstructor = this.identification.isLoading();
        }
      },
    );
    await render(Probe);
    expect(loadingInConstructor).toBe(false);
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
  });

  it('tolerates a component destroyed while its identification runs', async () => {
    const harness = setup();
    const fixture = await render(OnMount);
    const identification = fixture.componentInstance.identification;
    fixture.destroy();
    await harness.ready();
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
    expect(identification.isLoading()).toBe(false);
  });

  it('identifies again for a component that is created again (each one is a new page view)', async () => {
    const harness = setup();
    await harness.loaded();
    const first = await render(OnMount);
    first.destroy();
    await render(OnMount);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
  });

  it('is off by default', async () => {
    const harness = setup();
    await harness.loaded();
    const Plain = Component({ selector: 'sl-plain', standalone: true, template: '' })(
      class Plain {
        readonly identification = injectIdentify();
      },
    );
    await render(Plain);
    expect(harness.agent.identify).not.toHaveBeenCalled();
  });
});
