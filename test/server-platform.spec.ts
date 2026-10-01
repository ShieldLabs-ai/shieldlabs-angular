import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { load, ShieldLabsError } from '@shieldlabs-ai/js';
import { describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs, provideShieldLabs } from '../src/public-api';
import { flush, PUBLIC_KEY } from './support/fake-agent';
import { EmptyHost, render } from './support/harness';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs-ai/js')>()),
  load: vi.fn(),
}));

function serverSetup(): void {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }, provideShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true })],
  });
}

describe('on the server platform (PLATFORM_ID "server")', () => {
  it('never loads the agent, also after rendering', async () => {
    serverSetup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    await render(EmptyHost);
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();
  });

  it('rejects identify() and check() with unsupported_environment and leaves the state alone', async () => {
    serverSetup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identify = await shieldlabs.identify().catch((reason: unknown) => reason);
    expect(identify).toBeInstanceOf(ShieldLabsError);
    expect(identify).toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.check()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();
  });

  it('rejects getAgent() with unsupported_environment, and load() loads nothing', async () => {
    serverSetup();
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    shieldlabs.load();
    const error = await shieldlabs.getAgent().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'unsupported_environment', message: expect.stringContaining('getAgent()') as string });
    await render(EmptyHost);
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');
    expect(shieldlabs.error()).toBeNull();
  });

  it('does not end in an unhandled rejection when a call is ignored', async () => {
    serverSetup();
    // zone.js reports unhandled rejections through console.error instead of failing the test run.
    const consoleError = vi.spyOn(console, 'error');
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    const identification = TestBed.runInInjectionContext(() => injectIdentify());
    void shieldlabs.identify();
    void shieldlabs.check();
    void shieldlabs.getAgent();
    void identification.identify();
    await flush();
    await flush();
    expect(consoleError).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads nothing with autoLoad: false either, also after load()', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        provideShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true, autoLoad: false }),
      ],
    });
    const shieldlabs = TestBed.runInInjectionContext(() => injectShieldLabs());
    shieldlabs.load();
    await render(EmptyHost);
    // On the server a call reports the server, not the missing load().
    await expect(shieldlabs.identify()).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(shieldlabs.check()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(load).not.toHaveBeenCalled();
    expect(shieldlabs.status()).toBe('loading');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('injectIdentify() resolves null without touching its signals, and runOnMount does nothing', async () => {
    serverSetup();
    const Page = Component({ selector: 'sl-page', standalone: true, template: '' })(
      class Page {
        readonly identification = injectIdentify({ runOnMount: true });
      },
    );
    const fixture = await render(Page);
    const identification = fixture.componentInstance.identification;
    expect(load).not.toHaveBeenCalled();

    await expect(identification.identify()).resolves.toBeNull();
    expect(identification.isLoading()).toBe(false);
    expect(identification.error()).toBeNull();
    expect(identification.result()).toBeNull();
  });
});
