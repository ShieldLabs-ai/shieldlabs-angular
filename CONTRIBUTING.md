# Contributing to @shieldlabs-ai/angular

Thank you for improving the ShieldLabs Angular bindings.

## Set up

You need Node.js 20.19 or later (the build and lint tools need it, also for the default Angular 17
toolchain). Angular 22 needs Node.js 22.22 or 24.15 or later.

Install the development tools and the published `@shieldlabs-ai/js` peer dependency from this
repository's root. You do not need a checkout of another SDK.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
```

Repeat the second command after every `npm ci`, which removes the separately installed peer.
`--no-save` leaves `package.json` and `package-lock.json` unchanged.

### Why there is an `.npmrc`

The lockfile was created with `legacy-peer-deps=true`; the repository keeps that setting for
`npm ci`. The separate install uses `--legacy-peer-deps=false` to resolve the published peer.
`save-dev=true` makes saved installs development dependencies by default; `--no-save` above avoids
saving anything. These settings apply only to this checkout: npm does not publish `.npmrc`.

CI still builds the loader from its `main` branch and tests the packed copy. The commands above
instead test the published 1.x loader. To test a loader change, build and pack it in its own
checkout, then replace the package name in the second command with the path to that tarball.
Never commit a `file:` dependency or a tarball.

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
npm run use-angular -- 22 '@shieldlabs-ai/js@^1.0.0'
npm test && npm run build
npm ci                  # back to Angular 17
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
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
