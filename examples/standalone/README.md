# Standalone Angular example

A signup form in a standalone Angular application (zoneless, signals). `provideShieldLabs()` in
`src/app/app.config.ts` loads the ShieldLabs agent once after the first render.
`src/app/signup-form.ts` runs one identification when the form is submitted and sends the
`requestId` to your backend together with the signup.

## Run it

```bash
npm install
npm start
```

Open <http://localhost:4200>. The Public Key comes from the `define` option in `angular.json`
(`SHIELDLABS_PUBLIC_KEY`, a placeholder by default). Pass your own at build time, from
Integration > API keys in the analytics dashboard:

```bash
npx ng build --define "SHIELDLABS_PUBLIC_KEY='$SHIELDLABS_PUBLIC_KEY'"
```

The form posts JSON to `/api/signup`. Point it at your server (for example with
`ng serve --proxy-config`), which reads the verdict for `requestId` with a ShieldLabs server SDK,
for example `identifications.get(requestId)` in
[`@shieldlabs-ai/node`](https://github.com/ShieldLabs-ai/shieldlabs-node).

ShieldLabs accepts identifications only from registered domains. On `localhost` the request ID
still reaches the page, but no identification is recorded. Serve the example from a registered
development domain to see results in the [analytics dashboard](https://app.shieldlabs.ai).

## Build against local copies of the packages

Inside the `shieldlabs-angular` repository, before `@shieldlabs-ai/angular` and `@shieldlabs-ai/js` are
on npm (build and pack `@shieldlabs-ai/js` in its own repository first):

```bash
# repository root
npm ci
npm install --no-save ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz
npm run build
npm pack ./dist
cd examples/standalone
npm install --no-save --no-package-lock ../../shieldlabs-ai-angular-1.0.0.tgz ../../../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz
npm run build
```
