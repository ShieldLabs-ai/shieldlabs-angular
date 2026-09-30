import { Component, type ApplicationRef } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { load } from '@shieldlabs/js';
import { describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs, provideShieldLabs } from '../src/public-api';
import { PUBLIC_KEY } from './support/fake-agent';

vi.mock('@shieldlabs/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs/js')>()),
  load: vi.fn(),
}));

const SignupPage = Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <p id="status">status: {{ shieldlabs.status() }}</p>
    <p id="request">request: {{ identification.result()?.requestId ?? 'none' }}</p>
    <p id="loading">loading: {{ identification.isLoading() }}</p>
  `,
})(
  class SignupPage {
    readonly shieldlabs = injectShieldLabs();
    readonly identification = injectIdentify({ runOnMount: true });

    constructor() {
      // Calls made while the page renders on the server: nothing loads, nothing is identified, and
      // an ignored result does not end in an unhandled rejection.
      this.shieldlabs.load();
      void this.shieldlabs.getAgent();
      void this.identification.identify();
    }
  },
);

// Angular 20.3 and later pass a BootstrapContext that bootstrapApplication needs on the server;
// earlier majors call the function without arguments.
const bootstrap = (context?: unknown): Promise<ApplicationRef> =>
  (bootstrapApplication as (...args: unknown[]) => Promise<ApplicationRef>)(
    SignupPage,
    { providers: [provideServerRendering(), provideShieldLabs({ publicKey: PUBLIC_KEY, checkOnLoad: true })] },
    context,
  );

describe('server-side rendering with @angular/platform-server', () => {
  it('runs in plain Node.js without window or document', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders the page without loading the agent or identifying', async () => {
    // zone.js reports unhandled rejections through console.error.
    const consoleError = vi.spyOn(console, 'error');
    const html = await renderApplication(bootstrap, { document: '<app-root></app-root>', url: '/' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(html).toContain('status: loading');
    expect(html).toContain('request: none');
    expect(html).toContain('loading: false');
    expect(load).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
