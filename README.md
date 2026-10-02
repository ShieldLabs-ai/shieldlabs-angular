# @shieldlabs-ai/angular

Angular bindings for ShieldLabs: load the agent once with `provideShieldLabs()`, read its state from
signals and get a request ID for every protected action with `injectIdentify()`.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-angular/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-angular/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@shieldlabs-ai/angular)](https://www.npmjs.com/package/@shieldlabs-ai/angular)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

`@shieldlabs-ai/angular` is a thin layer over [`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js),
which loads the hosted ShieldLabs agent from `https://cdn.shieldlabs.ai`. It uses standalone APIs and
signals, also works in NgModule applications, and is safe with Angular SSR and hydration.

New to ShieldLabs? [Start free](https://app.shieldlabs.ai), then copy the Public Key of your domain
from Integration > API keys in the analytics dashboard (the Install tab also shows a ready snippet
that contains it).

## How it fits

1. **Browser.** `injectIdentify()` runs an identification when the user performs a protected action
   (signup, login, checkout) and gives your component a `requestId`.
2. **Your backend.** It receives the `requestId` with the action and reads the verdict for it from
   the History API with a ShieldLabs server SDK, or receives it in a signed `identification.scored`
   webhook.
3. **Decision.** Your backend acts on the Risk Score (bands: trusted 0-29, suspicious 30-59,
   dangerous 60-100), the detection flags and identifiers such as the device ID.

The browser only ever gets the request ID. The Risk Score, risk signals, detection flags, visitor ID
and device ID are read on your server.

Today the webhook is sent once per identification, with a 1 second timeout and no retries. Make
your webhook handler idempotent on `data.request_id`, because future retries will resend identical
bytes, and read the History API whenever your backend must have the result.

## Install

```bash
npm install @shieldlabs-ai/angular @shieldlabs-ai/js
```

`@shieldlabs-ai/js` is a peer dependency: the loader that both packages share.

## Quick start

The snippets are complete files of a new Angular 22 application (`ng new`). In an existing
application, add the ShieldLabs lines to your own files; before Angular 20 the root component is
`AppComponent` in `app.component.ts`, and in Angular 17 and 18 components also need
`standalone: true`.

Add the provider next to the providers that are already there:

```ts
// src/app/app.config.ts
import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideShieldLabs } from '@shieldlabs-ai/angular';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(), // skip it if your app already provides HttpClient
    provideShieldLabs({ publicKey: '0123456789abcdef0123456789abcdef' }),
  ],
};
```

Run an identification when the form is submitted and send the request ID with it:

```ts
// src/app/signup-form.ts
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { injectIdentify } from '@shieldlabs-ai/angular';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-signup-form',
  template: `
    <form (submit)="submit($event)">
      <input name="email" type="email" required />
      <button [disabled]="identification.isLoading()">Sign up</button>
    </form>
  `,
})
export class SignupForm {
  private readonly http = inject(HttpClient);
  protected readonly identification = injectIdentify();

  protected async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const email = new FormData(event.target as HTMLFormElement).get('email');
    // null when there is no identification: send the signup anyway, your server treats it as unverified.
    const result = await this.identification.identify();
    await firstValueFrom(this.http.post('/api/signup', { email, requestId: result?.requestId ?? null }));
  }
}
```

Render the form in your root component (the generated `app.html` and `app.css` are then unused):

```ts
// src/app/app.ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SignupForm } from './signup-form';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SignupForm],
  template: `
    <app-signup-form />
    <router-outlet />
  `,
})
export class App {}
```

`/api/signup` is your own endpoint. On your server, read the verdict for `requestId`, for example
with [`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node):

```ts
import { ShieldLabs } from '@shieldlabs-ai/node';

const shieldlabs = new ShieldLabs({ apiKey: process.env.SHIELDLABS_API_KEY! });

// Call it with the requestId from the body of POST /api/signup.
export async function readVerdict(requestId: string | null) {
  if (!requestId) return null; // no identification: unverified, never clean
  // Polls the History API (with backoff) until the row of this identification is there.
  return shieldlabs.identifications.get(requestId);
}
```

The History row appears about 1-3 seconds after `identify()` resolves and can be refined for up to
about 10 seconds as follow-up checks finish. To keep that wait off the submit, start the
identification when the user begins the action (see
[Start the identification early](#start-the-identification-early)).

> **Test on a registered domain.** ShieldLabs records identifications only for the domains
> registered in your account. On `localhost` (`ng serve`) the page still receives a `requestId`,
> but no identification is recorded and your backend never finds it. To try the whole path, open
> the page from a registered development domain with its own keys.

A complete application is in [`examples/standalone`](examples/standalone), and
[Unit tests of your components](#unit-tests-of-your-components) shows the test providers the
generated `app.spec.ts` needs after these steps.

## Guide

### Set up the provider

`provideShieldLabs(options)` returns `EnvironmentProviders`. Put it in the `providers` of
`bootstrapApplication` (or of your `ApplicationConfig`):

```ts
bootstrapApplication(App, {
  providers: [provideShieldLabs({ publicKey: environment.shieldlabsPublicKey })],
});
```

In an NgModule application, put it in the `providers` of the root module:

```ts
@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule],
  providers: [provideShieldLabs({ publicKey: environment.shieldlabsPublicKey })],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

In the browser, the provider loads the agent once, right after the application first renders
(`afterNextRender`), or earlier when a component calls `identify()`, `check()`, `getAgent()` or
`load()` first. The import itself is memoized by `@shieldlabs-ai/js` per agent URL and Public Key, so
the agent is loaded once per page, also with several providers or applications that use the same
Public Key and environment. With `autoLoad: false`, nothing loads until `load()` of
`injectShieldLabs()` is called (see [Consent](#call-budget-content-security-policy-and-consent)).

The Public Key is public (it ships to the browser), but keep it out of your source if you use
several environments: read it from an environment file, or pass `SHIELDLABS_PUBLIC_KEY` at build
time with the `define` option of the Angular CLI (see [`examples/standalone`](examples/standalone)).
For development and staging, register a separate domain with its own keys: identifications from a
page on `localhost` are not recorded.

### Protect a form

`injectIdentify()` returns an identify helper with three signals: `result`, `isLoading` and `error`.
Call it in an injection context (a field initializer or the constructor of a component), and call
`identify()` in the submit handler: one identification per protected action.

- `identify()` resolves `{ requestId, userId }`, or `null` when there is no identification. It never
  rejects: the reason is the `ShieldLabsError` in `error()` (see
  [Errors and retries](#errors-and-retries)), so the submit handler needs no `try`/`catch`.
- When the agent is not loaded yet, `identify()` waits for it (and starts loading it if needed). The
  `timeout` of the call (its own, else the `timeout` of the provider, else 10 seconds) covers the wait
  for the agent and its answer together, so a call never takes longer than that. With
  `autoLoad: false` it waits only once `load()` has been called; before that it resolves `null` at
  once with `not_initialized`.
- While a call is running, calling `identify()` again with the same User HID and `timeout` returns
  that call instead of starting another one, also when other calls of the helper started in
  between. The User HID of a call is its own `userId` when the options have that key (`undefined`
  and `null` both mean anonymous), else the helper's. This is deliberate: the agent runs one
  identification at a time per user and answers a second one with `not_initialized`. A double
  click therefore creates one identification, and both clicks get the same request ID, which your
  backend accepts once. To keep the second submission from being sent at all, disable the button
  while `isLoading()` is `true`, as in the quick start.
- A call without `timeout` counts as one with the `timeout` of the provider (10 seconds by
  default), so with the default `identify()` and `identify({ timeout: 10000 })` share one
  identification. The agent still gets the options as they were passed.
- A new call clears the previous `result` and `error`, and the signals follow the latest call, also
  when it returned a running one. `reset()` clears them and makes a running call leave the signals
  alone; a call after `reset()` starts a new identification.

Whenever there is no identification (the agent was blocked, it timed out), send the protected action
anyway without a `requestId`. Your backend treats a missing identification as unverified (for
example step-up or review), never as clean.

### Start the identification early

The History row of an identification appears about 1-3 seconds after `identify()` resolves, and
your server waits for it. To keep that wait off the submit, start the identification when the user
begins the action and use it on submit. The agent of `@shieldlabs-ai/js` does this with
`identifyOnInteraction(form)`: it starts an identification on the first focus, click or key press
in the form. Get the agent with `getAgent()` after the first render:

```ts
// src/app/signup-form.ts
import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { injectShieldLabs, type InteractionIdentifier } from '@shieldlabs-ai/angular';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-signup-form',
  template: `
    <form #form (submit)="submit($event)">
      <input name="email" type="email" required />
      <button [disabled]="submitting()">Sign up</button>
    </form>
  `,
})
export class SignupForm {
  private readonly http = inject(HttpClient);
  private readonly shieldlabs = injectShieldLabs();
  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>('form');
  private early: Promise<InteractionIdentifier> | undefined;
  protected readonly submitting = signal(false);

  constructor() {
    afterNextRender(() => {
      // Starts an identification on the first focus, click or key press in the form.
      this.early = this.shieldlabs.getAgent().then((agent) => agent.identifyOnInteraction(this.form().nativeElement));
      this.early.catch(() => undefined); // no agent: submit() sends the signup as unverified
    });
    inject(DestroyRef).onDestroy(() => {
      void this.early?.then((early) => early.dispose(), () => undefined);
    });
  }

  protected async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;
    this.submitting.set(true);
    const email = new FormData(event.target as HTMLFormElement).get('email');
    // take(): the identification started by the first interaction while it is fresh, or a new one.
    const result = await this.early?.then((early) => early.take()).catch(() => null);
    try {
      await firstValueFrom(this.http.post('/api/signup', { email, requestId: result?.requestId ?? null }));
    } finally {
      this.submitting.set(false);
    }
  }
}
```

`take()` never reuses an identification that failed or that finished more than four minutes ago
(your server accepts a request ID for five minutes), and it re-arms the form, so the next
submission gets its own identification. The button is disabled while a submission is being sent,
so each submission takes one identification. `dispose()` removes the listeners when the form goes
away. An identification started by an interaction is billable even when the user leaves without
submitting. When the agent cannot be loaded, the signup goes without a request ID and your server
treats it as unverified. With `autoLoad: false`, `getAgent()` waits for `load()`, so the form is
armed only once the agent may load.

### Send the request ID to your backend

Send the `requestId` in the same request as the protected action, for example in the JSON body of
your `HttpClient` call. The agent posts the identification right after `identify()` resolves, and
`HttpClient` keeps the page alive meanwhile. If the action ends in a full-page navigation (for
example a classic form post), start the identification early as shown above and navigate only
after your own request has been sent.

On the server, read the verdict with `identifications.get(requestId)` of a ShieldLabs server SDK,
which polls the History API until the row of the identification is there (see the timing in the
[quick start](#quick-start)):

- Node.js: [`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node)
- Python: [`shieldlabs`](https://github.com/ShieldLabs-ai/shieldlabs-python)
- Go: [`shieldlabs-go`](https://github.com/ShieldLabs-ai/shieldlabs-go)
- PHP: [`shieldlabs/shieldlabs-php`](https://github.com/ShieldLabs-ai/shieldlabs-php)
- Java: [`ai.shieldlabs:shieldlabs-java`](https://github.com/ShieldLabs-ai/shieldlabs-java)
- .NET: [`ShieldLabs`](https://github.com/ShieldLabs-ai/shieldlabs-dotnet)

Accept each request ID once and only within your freshness window (the examples use 5 minutes):
one identification authorizes one protected action.

### Signed-in users: pass a User HID

Pass a User HID so ShieldLabs ties the identification to the account. Compute it on your server
from your account ID with a secret key (for example with the `userHid()` helper of the server SDKs:
HMAC-SHA256, 64 hex characters) and send it to the page. Never pass a raw email address, phone
number or database ID.

`userId` accepts a string, or a signal (or any function) that is read when `identify()` runs, which
suits a User HID that arrives after sign-in:

```ts
export class CheckoutForm {
  private readonly session = inject(SessionStore); // your own service
  protected readonly identification = injectIdentify({ userId: this.session.userHid }); // Signal<string | null>
}
```

`null` or `undefined` means anonymous. Per-call options with a `userId` key win over the helper's
`userId`: `identify({ userId })`, or `identify({ userId: undefined })` (`null` works the same) for
an anonymous call. Only options without the key use the helper's `userId`. The reserved
values `"anonymous"`, `"fail"`, `"-1"` and `"unknown"` are rejected with `invalid_options`.
`@shieldlabs-ai/js` also warns once about values that look like an email address or contain `/`, `?`,
`#` or `%`: the History API looks a User HID up as a URL path segment and cannot search a value that
contains `/`. Use a hex hash (see
[Signed-in users](https://github.com/ShieldLabs-ai/shieldlabs-js#signed-in-users-pass-a-user-hid)).

### Show the agent state

`injectShieldLabs()` returns the state of the agent as signals, plus `identify()`, `check()`,
`load()` and `getAgent()`:

```ts
@Component({
  selector: 'app-agent-status',
  template: `
    @if (shieldlabs.status() === 'error') {
      <p>Device check unavailable ({{ shieldlabs.error()?.code }}). You can continue.</p>
    }
  `,
})
export class AgentStatus {
  protected readonly shieldlabs = injectShieldLabs();
}
```

`status` is `'loading'` until the agent is imported (with `autoLoad: false`, also before `load()`),
then `'ready'` or `'error'`; `error` holds the `ShieldLabsError` of a failed load. A failed load is
not kept: the next `identify()`, `check()`, `getAgent()` or `load()` loads again (`status` goes back
to `'loading'`). In development mode, a load that fails because of the setup (`invalid_options`, for
example a wrong Public Key, or `unsupported_environment` on a page that is not a secure context) is
also logged once with `console.warn`.

`injectShieldLabs().identify()` and `.check()` are the calls of `@shieldlabs-ai/js` without extra state:
every `identify()` is a fresh identification with a new request ID, and both reject with a
`ShieldLabsError`. Their `timeout` covers the wait for the agent and its answer, like the one of
`injectIdentify()`. With `autoLoad: false`, until `load()` is called, `identify()` rejects at once
with `not_initialized` and `check()` resolves `null`, as the agent does for a check it did not run.
Use `injectIdentify()` when you want the signals.

`load()` starts loading the agent now: with `autoLoad: false` it is the call that allows the agent
to load (see [Consent](#call-budget-content-security-policy-and-consent)); otherwise it loads before
the first render, or again after a failed load. `getAgent()` resolves the agent of `@shieldlabs-ai/js`
itself, for its `identifyOnInteraction()` (see
[Start the identification early](#start-the-identification-early)) and its other calls, which run
outside the Angular zone. It starts loading like `identify()`, waits for `load()` with
`autoLoad: false` (with no timeout of its own), and rejects with the `ShieldLabsError` of a failed
load.

### Identify on page view with `runOnMount`

`injectIdentify({ runOnMount: true })` calls `identify()` once after the component first renders in
the browser, never on later change detection. Each run is a billable identification, and a
component that is created again (for example when its route is visited again) runs it again. Use it
only where viewing the page is the protected action; for forms, call `identify()` on submit.

With `autoLoad: false`, call `load()` before the component first renders, for example in the
constructor of your root component when consent is already stored (see
[Consent](#call-budget-content-security-policy-and-consent)). A `runOnMount` identification that
starts before `load()` ends like `identify()`: it resolves `null` at once with `not_initialized`,
and it does not run again by itself after `load()`.

### Background checks with `checkOnLoad` and `check()`

`provideShieldLabs({ publicKey, checkOnLoad: true })` runs one `check()` when the agent becomes
ready, for passive monitoring of the visit; pass `checkOnLoad: { userId }` for a signed-in user.
`check()` is limited by the agent to one identification per visit every five minutes and resolves
`null` when the agent skipped it. The background check runs once per provider, also with
`autoLoad: false` (then when the agent is ready after `load()`). It is skipped when an `identify()`
or `check()` of your app for the same user (the same User HID, or both anonymous) is still running
at that moment, because that call already identifies the visit.

The agent runs one identification at a time per user, so an `identify()` that starts while a
background check is still running can end with `not_initialized` (`injectIdentify()` then resolves
`null`). Keep `checkOnLoad` for pages without a protected action, or handle `not_initialized` by
retrying once.

### Server-side rendering and hydration

Nothing is loaded on the server, and no code of this package touches `window` or `document` there.
During server-side rendering `status` stays `'loading'`, `runOnMount`, `checkOnLoad` and `load()`
do nothing, `injectIdentify().identify()` resolves `null`, and `identify()`, `check()` and
`getAgent()` of `injectShieldLabs()` reject with `unsupported_environment`. None of them changes a
signal, so the server-rendered HTML matches the first render in the browser, and a call that ignores
the rejection does not end in an unhandled rejection on the server. After hydration, the browser
loads the agent after the first render.

The agent and its timers run outside the Angular zone, so they neither trigger change detection nor
keep the application from becoming stable; signal updates re-enter the zone. This includes the wait
of a call for the agent and the calls of the agent from `getAgent()`. Zoneless applications work the
same way.

### Call budget, Content Security Policy and consent

These rules come from the agent and are documented once, in the `@shieldlabs-ai/js` README:

- [Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget): identify once per
  protected action, never on every render or client-side route change; the agent runs its own
  limited background checks on navigation, so backends can see extra identifications.
- [Content Security Policy](https://github.com/ShieldLabs-ai/shieldlabs-js#content-security-policy):
  the `script-src` and `connect-src` origins the agent needs.
- [Consent](https://github.com/ShieldLabs-ai/shieldlabs-js#consent): the agent does not read your
  consent banner, and once loaded it runs its own background checks. Where consent is required,
  load the agent only after consent, as shown below.

To load the agent only after consent, turn the automatic load off and call `load()` when the
visitor agrees:

```ts
// src/app/app.config.ts (providers)
provideShieldLabs({ publicKey: '0123456789abcdef0123456789abcdef', autoLoad: false }),
```

```ts
// your consent banner
export class ConsentBanner {
  private readonly shieldlabs = injectShieldLabs();

  protected accept(): void {
    // ...store the consent, then:
    this.shieldlabs.load();
  }
}
```

Until `load()` is called, nothing loads and no call waits for it:

- `injectIdentify().identify()` resolves `null` at once with a `not_initialized` error, so a
  protected action goes ahead as unverified without waiting. A `runOnMount` identification that
  starts then ends the same way and does not run again by itself after `load()`.
- `injectShieldLabs().identify()` rejects at once with `not_initialized`, and `check()` resolves
  `null`.
- `getAgent()` waits for `load()` and then for the agent, with no timeout of its own, and rejects
  when the load fails.

After `load()`, calls wait for the agent as usual and `checkOnLoad` runs once the agent is ready. On
later visits where consent is already stored, call `load()` at startup, for example in the
constructor of your root component, before any `runOnMount` identification starts.

### Unit tests of your components

TestBed does not use your application config, so a spec that renders a component with
`injectIdentify()` or `injectShieldLabs()` needs `provideShieldLabs()` in its own providers, like the
generated `app.spec.ts` after the quick start. Add it with `autoLoad: false`: the provider would
otherwise import the agent from the CDN after the first render, and with this option nothing loads
unless a test calls `load()`.

```ts
// src/app/app.spec.ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideShieldLabs } from '@shieldlabs-ai/angular';

import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideShieldLabs({ publicKey: '0123456789abcdef0123456789abcdef', autoLoad: false }),
      ],
    }).compileComponents();
  });

  it('renders the signup form', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-signup-form form')).not.toBeNull();
  });
});
```

To test what a component does with the result, replace `injectIdentify()` with a fake. With Vitest,
the test runner of `ng test` in new applications, mock `@shieldlabs-ai/angular` in the spec file
(`jest.mock` works the same way with Jest):

```ts
// src/app/signup-form.spec.ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SignupForm } from './signup-form';

const identify = vi.hoisted(() => vi.fn());

vi.mock('@shieldlabs-ai/angular', () => ({
  injectIdentify: () => ({ result: signal(null), isLoading: signal(false), error: signal(null), identify, reset: vi.fn() }),
}));

describe('SignupForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  it('sends the request ID with the signup', async () => {
    identify.mockResolvedValue({ requestId: '2c5ea4c0-4067-4b1a-9d3e-6f8a0b2c4d6e', userId: null });
    const fixture = TestBed.createComponent(SignupForm);
    await fixture.whenStable();
    const form = (fixture.nativeElement as HTMLElement).querySelector('form')!;
    form.querySelector('input')!.value = 'user@example.com';
    form.dispatchEvent(new Event('submit'));

    const request = await vi.waitFor(() => TestBed.inject(HttpTestingController).expectOne('/api/signup'));
    expect(request.request.body).toEqual({ email: 'user@example.com', requestId: '2c5ea4c0-4067-4b1a-9d3e-6f8a0b2c4d6e' });
    request.flush({});
  });

  it('sends the signup without a request ID when there is no identification', async () => {
    identify.mockResolvedValue(null);
    const fixture = TestBed.createComponent(SignupForm);
    await fixture.whenStable();
    const form = (fixture.nativeElement as HTMLElement).querySelector('form')!;
    form.querySelector('input')!.value = 'user@example.com';
    form.dispatchEvent(new Event('submit'));

    const request = await vi.waitFor(() => TestBed.inject(HttpTestingController).expectOne('/api/signup'));
    expect(request.request.body).toEqual({ email: 'user@example.com', requestId: null });
    request.flush({});
  });
});
```

Mock `@shieldlabs-ai/angular` rather than `load()` of `@shieldlabs-ai/js`: with the test runner of the
Angular CLI, a mock of `@shieldlabs-ai/js` in a spec file does not reach the import inside
`@shieldlabs-ai/angular`, so the real agent would be loaded.

## Reference

| Export | Description |
|---|---|
| `provideShieldLabs(options: ShieldLabsOptions): EnvironmentProviders` | Sets up ShieldLabs for an application or an NgModule. Loads the agent once in the browser, after the first render (with `autoLoad: false`, when `load()` is called) |
| `injectShieldLabs(): ShieldLabsRef` | The agent state (`status`, `error`) and calls (`identify`, `check`, `load`, `getAgent`) of the closest provider |
| `injectIdentify(options?: InjectIdentifyOptions): IdentifyRef` | An identify helper with `result`, `isLoading` and `error` signals |
| `ShieldLabsError` | The error class of `@shieldlabs-ai/js`, re-exported. Has `code` and optional `cause` |
| Types | `ShieldLabsOptions`, `ShieldLabsStatus`, `ShieldLabsRef`, `InjectIdentifyOptions`, `IdentifyRef`, and from `@shieldlabs-ai/js`: `IdentifyOptions`, `IdentifyResult`, `ShieldLabsAgent`, `InteractionIdentifier`, `ShieldLabsErrorCode` |

`injectShieldLabs()` and `injectIdentify()` need an injection context. Elsewhere, wrap the call in
`runInInjectionContext(injector, () => injectIdentify())`. Both throw a `ShieldLabsError` with the
code `invalid_options` when no `provideShieldLabs()` is in scope.

`ShieldLabsOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `publicKey` | `string` | required | Public Key of your domain |
| `environment` | `'production' \| 'development'` | `'production'` | Which ShieldLabs CDN the agent is loaded from |
| `scriptUrl` | `string` | | Advanced: agent module URL override (`https`, or `http` on `localhost` and `127.0.0.1`) |
| `timeout` | `number` | `10000` | Milliseconds a call may take when it sets no `timeout` of its own: the wait for the agent and its answer together. Also the limit for importing the agent |
| `checkOnLoad` | `boolean \| { userId?: string }` | `false` | Runs `check()` once when the agent becomes ready, unless a call of the app for the same user is still running |
| `autoLoad` | `boolean` | `true` | Loads the agent after the first render (or on an earlier call). `false` loads nothing until `load()` is called; until then `identify()` fails at once with `not_initialized` (`injectIdentify().identify()` resolves `null`), `check()` resolves `null` and `getAgent()` waits |

`ShieldLabsRef` (from `injectShieldLabs()`)

| Member | Type | Description |
|---|---|---|
| `status` | `Signal<'loading' \| 'ready' \| 'error'>` | Load state of the agent. `'loading'` during server-side rendering and, with `autoLoad: false`, before `load()` |
| `error` | `Signal<ShieldLabsError \| null>` | Why the agent could not be loaded |
| `identify(options?)` | `Promise<IdentifyResult>` | Fresh identification with a new request ID. Waits for the agent; `options.timeout` covers the wait and the answer. Rejects with a `ShieldLabsError`: with `autoLoad: false`, with `not_initialized` at once until `load()` is called |
| `check(options?)` | `Promise<IdentifyResult \| null>` | Background check, `null` when the agent skipped it, and at once with `autoLoad: false` until `load()` is called. Waits for the agent like `identify()` |
| `load()` | `void` | Starts loading the agent: with `autoLoad: false`, the call that allows it; otherwise earlier than the first render, or again after a failed load. Does nothing while a load runs, once the agent is ready, and on the server |
| `getAgent()` | `Promise<ShieldLabsAgent>` | The agent of `@shieldlabs-ai/js` (`identify`, `check`, `identifyOnInteraction`), its calls outside the Angular zone. Starts loading like `identify()`; with `autoLoad: false`, waits for `load()` with no timeout of its own. Rejects with the error of a failed load, and with `unsupported_environment` on the server |

`InjectIdentifyOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `userId` | `string \| Signal<string \| null \| undefined> \| (() => string \| null \| undefined)` | anonymous | User HID for every call of this helper, read when `identify()` runs |
| `runOnMount` | `boolean` | `false` | Calls `identify()` once after the component first renders in the browser. With `autoLoad: false`, call `load()` before that render: a run that starts before `load()` resolves `null` with `not_initialized` and does not run again |

`IdentifyRef` (from `injectIdentify()`)

| Member | Type | Description |
|---|---|---|
| `result` | `Signal<IdentifyResult \| null>` | The latest identification: `{ requestId, userId }`. `null` before and during a call |
| `isLoading` | `Signal<boolean>` | `true` while an identification runs |
| `error` | `Signal<ShieldLabsError \| null>` | Why the latest identification failed |
| `identify(options?)` | `Promise<IdentifyResult \| null>` | Runs an identification and updates the signals. Resolves `null` when there is none and never rejects: the reason is in `error` (`not_initialized` at once with `autoLoad: false` until `load()` is called). `options`: `{ userId?, timeout? }`; a `userId` key overrides the helper's `userId` (`undefined` and `null` mean anonymous), and `timeout` covers the wait for the agent and its answer. A running call of this helper with the same User HID and `timeout` (an omitted `timeout` counts as the provider's) is returned instead of starting another |
| `reset()` | `void` | Clears the signals; a running call no longer updates them |

## Errors and retries

Every error is a `ShieldLabsError`. Branch on `error.code`:

| `code` | When | What to do |
|---|---|---|
| `invalid_options` | An option failed validation (`publicKey`, `userId`, `timeout` and others), or `injectShieldLabs()` / `injectIdentify()` found no `provideShieldLabs()` | Fix the setup; retrying does not help |
| `unsupported_environment` | A call during server-side rendering, or a page that is not a secure context | Identify in the browser; serve the page over HTTPS (`localhost` and `127.0.0.1` also work over `http`) |
| `load_failed` | The agent could not be imported: network error, content blocker, Content Security Policy. `cause` holds the original error | Continue without an identification. The next call loads again |
| `not_initialized` | The agent did not start an identification, for example because another one is running in this or another tab. Also an `identify()` before `load()` with `autoLoad: false` | Retry once later, or continue without an identification |
| `timeout` | The agent did not load or answer within the `timeout` of the call (default: the provider's, 10 seconds), which covers both | Continue without an identification |

`injectIdentify().identify()` never rejects: it resolves `null` and shows the error in `error()`.
The other calls reject with it. The package never retries an identification by itself: each one is
billable. A failed agent load is retried on the next `identify()`, `check()`, `getAgent()` or
`load()`. More detail on each code:
[Errors in `@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js#errors).

## Compatibility

- Angular 17, 18, 19, 20, 21 and 22 (`@angular/core` and `@angular/common` as peer dependencies),
  standalone and NgModule applications, zone-based and zoneless change detection, Angular SSR and
  hydration.
- `@shieldlabs-ai/js` 1.x as a peer dependency. Browser support and the secure-context requirement are
  those of [`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js#compatibility).
- Angular Package Format (ES2022 FESM bundle with TypeScript declarations), compiled with the Angular
  17 toolchain in partial compilation mode. The package declares no components, directives or
  NgModules; it uses public Angular APIs only.
- CI builds the package and runs the tests against every supported Angular major.

## Development

From the repository root, install the development tools and the published loader. No sibling
repository is required. Repeat the loader install after each `npm ci`.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
npm run lint                  # tsc --noEmit (strict) and ESLint
npm test                      # Vitest: jsdom and plain Node.js (server-side rendering)
npm run test:coverage
npm run build                 # ng-packagr, output in dist/
npm run audit:deps            # npm audit: none in runtime dependencies, allowlisted ones in dev
npm run use-angular -- 22 '@shieldlabs-ai/js@^1.0.0'   # test against another major
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Documentation: <https://docs.shieldlabs.ai>. Analytics
dashboard: <https://app.shieldlabs.ai>. Support: <contact@shieldlabs.ai>.

## License

[MIT](./LICENSE), Copyright (c) 2026 ShieldLabs Inc.
