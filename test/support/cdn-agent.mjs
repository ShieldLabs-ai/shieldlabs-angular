// A stand-in for the hosted ShieldLabs agent module in the loader tests. It has the four exports that
// @shieldlabs/js calls and answers like the agent: through `onInitialized` inside the options object,
// once per call and asynchronously, with one frozen object. The tests steer it and read what it saw
// through `globalThis.__shieldlabsTestAgent` (see test/shieldlabs-js.loader.spec.ts).
const url = new URL(import.meta.url).searchParams.get('url');

function registry() {
  return globalThis.__shieldlabsTestAgent;
}

// Runs once per imported URL: Node.js caches the module like a browser does.
registry()?.imports.push(url);

let counter = 0;

function run(method, userHid, options) {
  const agent = registry();
  agent?.calls.push({ url, method, userHid, options, zone: globalThis.Zone?.current.name });
  const answer = agent?.answer ?? 'initialized';
  if (answer === 'silent') return;
  counter += 1;
  const requestID = '3d5f7a9c-1e3b-4d6f-8a0c-' + counter.toString(16).padStart(12, '0');
  void Promise.resolve().then(() => {
    options.onInitialized(
      Object.freeze(answer === 'initialized' ? { status: 'initialized', requestID } : { status: 'not_initialized' }),
    );
  });
}

export function checkAnonymous(options) {
  run('checkAnonymous', undefined, options);
}

export function checkAuthenticatedUser(userHid, options) {
  run('checkAuthenticatedUser', userHid, options);
}

export function forceCheckAnonymous(options) {
  run('forceCheckAnonymous', undefined, options);
}

export function forceCheckAuthenticatedUser(userHid, options) {
  run('forceCheckAuthenticatedUser', userHid, options);
}
