import { Component, createEnvironmentInjector, EnvironmentInjector, NgModule, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { load, ShieldLabsError, type ShieldLabsAgent } from '@shieldlabs/js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs, provideShieldLabs, type ShieldLabsOptions } from '../src/public-api';
import { deferred, fakeAgent, flush, PUBLIC_KEY } from './support/fake-agent';
import { EmptyHost, render, setup } from './support/harness';

vi.mock('@shieldlabs/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs/js')>()),
  load: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('provideShieldLabs', () => {
  it('provides the agent state to the application injector', () => {
    setup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();
    expect(typeof shieldlabs.identify).toBe('function');
    expect(typeof shieldlabs.check).toBe('function');
    expect(typeof shieldlabs.load).toBe('function');
    expect(typeof shieldlabs.getAgent).toBe('function');
    expect(Object.keys(shieldlabs).sort()).toEqual(['check', 'error', 'getAgent', 'identify', 'load', 'status']);
  });

  it('loads nothing while the injector is created, then loads once after the first render', async () => {
    setup();
    TestBed.inject(EnvironmentInjector);
    // Angular 18 and later schedule a tick for the render hook, so only the synchronous part is checked.
    expect(load).not.toHaveBeenCalled();

    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });

    const fixture = TestBed.createComponent(EmptyHost);
    fixture.detectChanges();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('passes the load options through and keeps checkOnLoad for itself', async () => {
    setup({
      environment: 'development',
      scriptUrl: 'https://localhost:4443/snippet.js',
      timeout: 5000,
      checkOnLoad: true,
    });
    await render(EmptyHost);
    expect(load).toHaveBeenCalledWith({
      publicKey: PUBLIC_KEY,
      environment: 'development',
      scriptUrl: 'https://localhost:4443/snippet.js',
      timeout: 5000,
    });
  });

  it('passes every other option to load(), also options that later versions of @shieldlabs/js add', async () => {
    const future = { futureLoadOption: 'on' } as unknown as Partial<ShieldLabsOptions>;
    setup({ timeout: undefined, checkOnLoad: false, autoLoad: true, ...future });
    await render(EmptyHost);
    expect(vi.mocked(load).mock.calls[0]?.[0]).toStrictEqual({ publicKey: PUBLIC_KEY, futureLoadOption: 'on' });
  });

  it('autoLoad: false loads nothing until load() is called, then loads once', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');

    shieldlabs.load();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
    shieldlabs.load();
    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(1);

    await harness.ready();
    expect(shieldlabs.status()).toBe('ready');
    await expect(shieldlabs.identify({ userId: 'hid_1' })).resolves.toMatchObject({ userId: 'hid_1' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('autoLoad: false fails identify() at once before load(), check() resolves null, and injectIdentify() resolves null', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    await render(EmptyHost);

    const error = await shieldlabs.identify().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({
      code: 'not_initialized',
      message: 'identify() needs the agent, which is not loaded: with autoLoad: false, call load() of injectShieldLabs() first.',
    });
    // Like check() of @shieldlabs/js, which resolves null when the agent is not initialized.
    await expect(shieldlabs.check()).resolves.toBeNull();
    await expect(shieldlabs.check({ userId: 'hid_1', timeout: 60000 })).resolves.toBeNull();
    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.error()?.code).toBe('not_initialized');
    expect(identification.isLoading()).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();

    // After load(), check() waits for the agent and reaches it.
    shieldlabs.load();
    const checked = shieldlabs.check({ userId: 'hid_1' });
    await harness.ready();
    await expect(checked).resolves.toMatchObject({ userId: 'hid_1' });
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
  });

  it('autoLoad: false lets getAgent() wait for load()', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    let agent: ShieldLabsAgent | undefined;
    void shieldlabs.getAgent().then((value) => {
      agent = value;
    });
    await render(EmptyHost);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(agent).toBeUndefined();

    shieldlabs.load();
    await harness.ready();
    expect(agent).toBeDefined();
    await expect(shieldlabs.getAgent()).resolves.toBe(agent);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('autoLoad: false: getAgent() has no timeout of its own, before and after load()', async () => {
    vi.useFakeTimers();
    const harness = setup({ autoLoad: false, timeout: 3000 });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    let outcome: 'resolved' | 'rejected' | undefined;
    void shieldlabs.getAgent().then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      },
    );

    // Far beyond the provider timeout, and no timer runs for it.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(load).not.toHaveBeenCalled();

    // After load() it waits for the load itself (which @shieldlabs/js limits), with no timer of its own.
    shieldlabs.load();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(outcome).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    harness.loading.resolve(harness.agent);
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('resolved');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('autoLoad: false lets a getAgent() made before load() get the result of the first load', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const failure = new ShieldLabsError('load_failed', 'offline');
    const pending = shieldlabs.getAgent();
    shieldlabs.load();
    harness.loading.reject(failure);
    await expect(pending).rejects.toBe(failure);
    expect(shieldlabs.status()).toBe('error');

    // load() allowed loading: from now on calls load again by themselves.
    vi.mocked(load).mockResolvedValue(harness.agent);
    await expect(shieldlabs.identify()).resolves.toMatchObject({ userId: null });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('autoLoad: false lets calls made after load() wait for the agent', async () => {
    const harness = setup({ autoLoad: false });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify({ userId: 'hid_2' }));
    shieldlabs.load();
    const pending = identification.identify();
    expect(identification.isLoading()).toBe(true);
    await harness.ready();
    await expect(pending).resolves.toMatchObject({ userId: 'hid_2' });
    expect(identification.error()).toBeNull();
  });

  it('autoLoad: false runs checkOnLoad once the agent loaded after load()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = setup({ autoLoad: false, checkOnLoad: { userId: 'hid_1' } });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    expect(harness.agent.check).not.toHaveBeenCalled();

    shieldlabs.load();
    await harness.ready();
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(harness.agent.check).toHaveBeenCalledWith({ userId: 'hid_1' });

    shieldlabs.load();
    await flush();
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('copies the options when it is called', async () => {
    const options = { publicKey: PUBLIC_KEY };
    vi.mocked(load).mockReturnValue(new Promise(() => undefined));
    TestBed.configureTestingModule({ providers: [provideShieldLabs(options)] });
    options.publicKey = 'changed';
    await render(EmptyHost);
    expect(load).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
  });

  it('loads the agent once for many components and calls', async () => {
    const harness = setup();
    const Consumer = Component({ selector: 'sl-consumer', standalone: true, template: '{{ shieldlabs.status() }}' })(
      class Consumer {
        readonly shieldlabs = injectShieldLabs();
        readonly identification = injectIdentify();
      },
    );
    const first = await render(Consumer);
    const second = await render(Consumer);
    await harness.ready();

    await first.componentInstance.shieldlabs.identify();
    await second.componentInstance.identification.identify();
    await first.componentInstance.shieldlabs.check();
    expect(load).toHaveBeenCalledTimes(1);
    expect(harness.agent.identify).toHaveBeenCalledTimes(2);
    expect(harness.agent.check).toHaveBeenCalledTimes(1);
  });

  it('starts loading on the first call when no render happened yet', async () => {
    const harness = setup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const pending = shieldlabs.identify();
    expect(load).toHaveBeenCalledTimes(1);
    await harness.ready();
    await expect(pending).resolves.toEqual({ requestId: expect.any(String) as string, userId: null });
  });

  it('works in the providers of an NgModule', async () => {
    const agent = fakeAgent();
    vi.mocked(load).mockResolvedValue(agent);
    const AppModule = NgModule({ providers: [provideShieldLabs({ publicKey: PUBLIC_KEY })] })(class AppModule {});
    TestBed.configureTestingModule({ imports: [AppModule] });

    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shieldlabs.status()).toBe('ready');
  });

  it('gives a child environment injector (for example route providers) its own state', async () => {
    const loading = deferred<never>();
    vi.mocked(load).mockReturnValue(loading.promise);
    TestBed.configureTestingModule({ providers: [provideShieldLabs({ publicKey: PUBLIC_KEY })] });
    const root = TestBed.inject(EnvironmentInjector);
    const child = createEnvironmentInjector([provideShieldLabs({ publicKey: 'abcdefabcdefabcdefabcdefabcdefab' })], root);

    const rootRef = runInInjectionContext(root, () => injectShieldLabs());
    const childRef = runInInjectionContext(child, () => injectShieldLabs());
    expect(childRef).not.toBe(rootRef);

    await render(EmptyHost);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
    expect(load).toHaveBeenCalledWith({ publicKey: 'abcdefabcdefabcdefabcdefabcdefab' });
    child.destroy();
  });

  it('surfaces invalid options as an error state instead of throwing, with one warning in development mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(load).mockRejectedValue(new ShieldLabsError('invalid_options', 'publicKey must match'));
    TestBed.configureTestingModule({ providers: [provideShieldLabs({ publicKey: '' })] });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    expect(shieldlabs.status()).toBe('error');
    expect(shieldlabs.error()?.code).toBe('invalid_options');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[ShieldLabs] Could not load the agent: publicKey must match');

    // Every call loads again and fails the same way: the console gets no second warning.
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'invalid_options' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns in development mode when the page is not a secure context', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const insecure = 'The page is not a secure context: the agent needs HTTPS (or localhost).';
    vi.mocked(load).mockRejectedValue(new ShieldLabsError('unsupported_environment', insecure));
    TestBed.configureTestingModule({ providers: [provideShieldLabs({ publicKey: PUBLIC_KEY })] });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    expect(shieldlabs.error()?.code).toBe('unsupported_environment');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[ShieldLabs] Could not load the agent: ' + insecure);
  });

  it('does not warn when a content blocker or the network stops the agent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = setup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    harness.loading.reject(new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.'));
    await flush();
    expect(shieldlabs.status()).toBe('error');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('without provideShieldLabs', () => {
  it('injectShieldLabs() throws a ShieldLabsError that names the missing provider', () => {
    const error = captureError(() => TestBed.runInInjectionContext(() => injectShieldLabs()));
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect((error as ShieldLabsError).code).toBe('invalid_options');
    expect((error as ShieldLabsError).message).toContain('provideShieldLabs');
  });

  it('injectIdentify() throws a ShieldLabsError that names the missing provider', () => {
    const error = captureError(() => TestBed.runInInjectionContext(() => injectIdentify()));
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect((error as ShieldLabsError).message).toContain('injectIdentify()');
  });

  it('both need an injection context', () => {
    expect(() => injectShieldLabs()).toThrow(/injection context/);
    expect(() => injectIdentify()).toThrow(/injection context/);
  });
});
