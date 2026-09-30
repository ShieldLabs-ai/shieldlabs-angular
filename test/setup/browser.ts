// Browser tests: jsdom, zone.js (the Angular 17 TestBed needs it) and the JIT compiler for the test
// components. The platform-browser-dynamic testing entry point exists in every supported major.
import 'zone.js';
import '@angular/compiler';

import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-deprecated -- the replacement needs Angular 20
TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting(), {
  teardown: { destroyAfterEach: true },
});

afterEach(() => {
  TestBed.resetTestingModule();
});
