import * as core from '@angular/core';
import { Component, type EnvironmentProviders } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { injectIdentify, injectShieldLabs } from '../src/public-api';
import { setup } from './support/harness';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shieldlabs-ai/js')>()),
  load: vi.fn(),
}));

// Zoneless change detection: stable from Angular 20, experimental in 18 and 19, absent in 17.
const exports = core as unknown as Record<string, (() => EnvironmentProviders) | undefined>;
const provideZoneless =
  exports['provideZonelessChangeDetection'] ?? exports['provideExperimentalZonelessChangeDetection'];

describe.skipIf(!provideZoneless)('in a zoneless application', () => {
  const Page = Component({
    selector: 'sl-zoneless-page',
    standalone: true,
    template: '{{ shieldlabs.status() }} {{ identification.result()?.requestId ?? "none" }}',
  })(
    class Page {
      readonly shieldlabs = injectShieldLabs();
      readonly identification = injectIdentify({ runOnMount: true });
    },
  );

  it('loads after the first render and updates the template from signals', async () => {
    // The browser tests load zone.js for Angular 17; hide only Angular's notice about that (NG0914).
    const warn = console.warn.bind(console);
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).includes('NG0914')) warn(...args);
    });
    const harness = setup({}, [provideZoneless!()]);
    harness.agent.identify.mockResolvedValue({ requestId: '4e6a8c0b-2d4f-4a6c-8e0b-2d4f6a8c0e2b', userId: null });
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('loading none');

    await harness.ready();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('ready 4e6a8c0b-2d4f-4a6c-8e0b-2d4f6a8c0e2b');
    expect(harness.agent.identify).toHaveBeenCalledTimes(1);
  });
});
