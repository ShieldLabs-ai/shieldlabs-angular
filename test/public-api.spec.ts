import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import * as api from '../src/public-api';

describe('public API', () => {
  it('exports functions only (no NgModule, no service class) plus the ShieldLabsError class', () => {
    expect(Object.keys(api).sort()).toEqual(['ShieldLabsError', 'injectIdentify', 'injectShieldLabs', 'provideShieldLabs']);
    expect(typeof api.provideShieldLabs).toBe('function');
    expect(typeof api.injectShieldLabs).toBe('function');
    expect(typeof api.injectIdentify).toBe('function');
  });

  it('re-exports the ShieldLabsError of @shieldlabs-ai/js', async () => {
    const core = await import('@shieldlabs-ai/js');
    expect(api.ShieldLabsError).toBe(core.ShieldLabsError);
  });
});

describe('package.json', () => {
  it('declares @shieldlabs-ai/js as a required peer dependency, next to Angular 17 to 22', () => {
    expect(manifest.peerDependencies).toEqual({
      '@angular/common': '^17.0.0 || ^18.0.0 || ^19.0.0 || ^20.0.0 || ^21.0.0 || ^22.0.0',
      '@angular/core': '^17.0.0 || ^18.0.0 || ^19.0.0 || ^20.0.0 || ^21.0.0 || ^22.0.0',
      '@shieldlabs-ai/js': '^1.0.0',
    });
    expect(manifest).not.toHaveProperty('peerDependenciesMeta');
    expect(Object.keys(manifest.dependencies)).toEqual(['tslib']);
  });
});
