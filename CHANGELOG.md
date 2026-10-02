# Changelog

All notable changes to `@shieldlabs-ai/angular` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Contributor and example setup uses published ShieldLabs peers from npm. Local tarballs remain
  optional for testing changes; a checkout of another SDK is no longer required.

## [1.0.0] - 2026-09-30

### Added

- `provideShieldLabs(options)`: environment providers for `bootstrapApplication` and for the
  `providers` of an NgModule. In the browser, loads the agent once after the first render with
  `load()` of `@shieldlabs-ai/js`. Options: `checkOnLoad`, `autoLoad` and every `load()` option
  (`publicKey`, `environment`, `scriptUrl`, `timeout`), which are passed to `load()` as they are.
- In development mode, a load that fails because of the setup (`invalid_options`, for example a
  wrong Public Key, or `unsupported_environment` on a page that is not a secure context) is logged
  once with `console.warn`.
- `injectShieldLabs()`: the agent `status` (`loading`, `ready`, `error`) and `error` as signals,
  plus `identify()` and `check()`, which wait for the agent and start loading it when needed, and
  reject with a `ShieldLabsError`.
- `injectShieldLabs().load()`: starts loading the agent now. With `autoLoad: false` it is the call
  that allows the agent to load; after a failed load it loads again.
- `injectShieldLabs().getAgent()`: resolves the agent of `@shieldlabs-ai/js`, for example to start an
  identification on the first interaction with a form (`identifyOnInteraction()`) before a full-page
  form post. Its calls run outside the Angular zone. With `autoLoad: false` it waits for `load()`,
  with no timeout of its own.
- `injectIdentify({ userId, runOnMount })`: an identify helper with `result`, `isLoading` and
  `error` signals, `identify()` and `reset()`. `identify()` resolves the result, or `null` when there
  is no identification, and never rejects: the reason is the `ShieldLabsError` in `error`. `userId`
  takes a string or a signal read at call time; call options with a `userId` key override it, and
  `undefined` and `null` there both mean an anonymous call. A running call of the helper with the
  same User HID and `timeout` is returned instead of starting another one (the agent runs one
  identification at a time per user), so a double click creates one identification; a call without
  `timeout` counts as one with the `timeout` of the provider, and the signals follow the call that
  is returned.
  `runOnMount` identifies once after the component first renders in the browser; with
  `autoLoad: false` before `load()` it resolves `null` with `not_initialized`, like `identify()`,
  and does not run again after `load()`.
- The `timeout` of a call (its own, else the `timeout` of the provider, else 10 seconds) covers the
  wait for the agent to load and the answer of the agent together: a call that waits for the agent
  passes it only the time that is left.
- `checkOnLoad`: one background `check()` when the agent becomes ready (`true` or `{ userId }`),
  also after `load()` with `autoLoad: false`. It is skipped when an `identify()` or `check()` of the
  app for the same user is still running at that moment.
- `autoLoad: false`: nothing loads until `load()` is called, for pages that may run the agent only
  after consent and for unit tests. Until then no call waits for it: `identify()` fails at once with
  `not_initialized` (`injectIdentify().identify()` resolves `null`), so a protected action is not
  held up, `check()` resolves `null`, and `getAgent()` waits for `load()`.
- Server-side rendering and hydration: nothing is loaded on the server and no browser globals are
  touched; `injectIdentify().identify()` resolves `null`, the other calls reject with
  `unsupported_environment`, and no signal changes.
- The agent runs outside the Angular zone and signal updates re-enter it; zone-based and zoneless
  applications are supported.
- Every error is a `ShieldLabsError` (re-exported from `@shieldlabs-ai/js`, with the `ShieldLabsAgent`
  and `InteractionIdentifier` types). A failed agent load is retried on the next call.
- Support for Angular 17 to 22, packaged in the Angular Package Format with ng-packagr.
- Example: `examples/standalone`, a zoneless Angular signup form.

[Unreleased]: https://github.com/ShieldLabs-ai/shieldlabs-angular/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ShieldLabs-ai/shieldlabs-angular/releases/tag/v1.0.0
