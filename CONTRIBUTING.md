# Contributing to @shieldlabs-ai/angular

Thank you for improving the ShieldLabs Angular bindings.

## Set up

You need Node.js 20.19 or later (the build and lint tools need it, also for the default Angular 17
toolchain). Angular 22 needs Node.js 22.22 or 24.15 or later.

```bash
npm ci
npm install --no-save <path to shieldlabs-ai-js-1.0.0.tgz>
```

### Until @shieldlabs-ai/js is on npm

`@shieldlabs-ai/js` is a peer dependency that is not published yet, so npm cannot resolve it from the
registry. The loader is installed from a local tarball instead: build it in a working copy of
[shieldlabs-js](https://github.com/ShieldLabs-ai/shieldlabs-js) with
`npm ci && npm run build && npm pack`, and install it again after every `npm ci`, which removes it.
Never commit a `file:` dependency or a tarball.

The committed `.npmrc` makes this work with plain npm commands:

- `legacy-peer-deps=true`: `npm install` and `npm ci` do not try to install peer dependencies (they
  would fail with a 404 for `@shieldlabs-ai/js`). Because of this setting, the dependencies of the
  Angular packages are listed explicitly in `devDependencies`.
- `save-dev=true`: `npm install --no-save <tarball>` puts the loader into `node_modules`. With
  `legacy-peer-deps` alone, npm leaves out a package that is listed as a peer dependency, even when
  it is named on the command line. The setting also makes `npm install <package>` add a dev
  dependency by default: pass `--save-prod` to add or update a runtime dependency.

These settings apply to development only: the published package declares `@shieldlabs-ai/js` as a
regular (required) peer dependency, and the workflows keep working after `@shieldlabs-ai/js` 1.0.0 is
on npm. Once it is, the setup can be simplified: remove `.npmrc`, regenerate `package-lock.json` and
drop the tarball steps (here, in the README, in `examples/standalone/README.md` and in the
workflows).

## Checks

Run these before you open a pull request:

```bash
npm run lint            # tsc --noEmit (strict) and ESLint
npm run test:coverage   # Vitest; coverage must stay at 95 % or more
npm run build           # ng-packagr, output in dist/
npm run audit:deps      # npm audit: no advisories in runtime dependencies, only allowlisted ones in dev
```

`npm run audit:deps` fails on any advisory in a runtime dependency and on any advisory in a
development dependency that is not in the allowlist of `scripts/audit.mjs`. The allowlist holds the
advisories of the Angular 17 packages the package is compiled with (none of their code is
published); add an entry only with the reason why it does not reach the published package.

The tests run in three Vitest projects:

- `browser`: jsdom and TestBed, with `load()` of `@shieldlabs-ai/js` mocked.
- `loader`: jsdom and TestBed with the real `@shieldlabs-ai/js`. Its native `import()` of the agent URL
  is answered by Node.js module hooks (`test/support/cdn-hooks.mjs`) with a local stand-in for the
  agent (`test/support/cdn-agent.mjs`).
- `server`: plain Node.js without `window` or `document`, rendering with `@angular/platform-server`.

## Angular versions

The package is built with the oldest supported major (Angular 17): the Angular Package Format output
of a newer compiler is not meant to be used by older applications. To run the tests and the build
against another major, swap the toolchain in `node_modules` (package files stay unchanged):

```bash
npm run use-angular -- 22 <path to shieldlabs-ai-js-1.0.0.tgz>
npm test && npm run build
npm ci                  # back to Angular 17, then install the tarball again
```

CI runs the tests and the build on every supported major (17 to 22) and builds
`examples/standalone` against the packed package.

## Guidelines

- The package stays a thin layer over `@shieldlabs-ai/js`: it never imports the agent itself and never
  touches `window` or `document`. Loading starts in the browser only (`isPlatformBrowser`,
  `afterNextRender`).
- No decorators, components or NgModules in `src/`: plain functions and an `InjectionToken`. This
  keeps the compiled output free of version-specific compiler declarations.
- The agent runs outside the Angular zone (`runOutsideAngular`); signal updates go through `NgZone.run`
  and `untracked`, so they work from effects and in zoneless applications.
- Every change comes with tests. Add a line to `CHANGELOG.md` under "Unreleased" and use
  conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
- Documentation style: plain technical English, "risk signals", and the three risk bands trusted
  0-29, suspicious 30-59 and dangerous 60-100.

## Releasing

Maintainers update the version in `package.json`, move the "Unreleased" changelog entries under the
new version, and push a tag such as `v1.0.1`. The release workflow checks that the tag matches
`package.json`, runs all checks and builds the package with ng-packagr in one job, then publishes
the built `dist/` to npm with provenance in a second job that runs in the `npm` environment, with
the `NPM_TOKEN` secret. Add required reviewers to that environment (Settings > Environments) to
approve every publish. The workflow is safe to re-run: a version that is already on npm is not
published again. Always publish `dist/`: a `prepublishOnly` script stops a publish from the
repository root.

## Security

Please report security issues privately to <contact@shieldlabs.ai> rather than in a public issue.
