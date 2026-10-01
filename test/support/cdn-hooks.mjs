// Module hooks for the loader tests, registered by test/setup/cdn-agent.mjs. @shieldlabs-ai/js imports
// the agent module from an https URL at runtime; these hooks answer every https import with
// test/support/cdn-agent.mjs, a stand-in for the hosted agent, and keep the requested URL in the
// query string so that the stand-in can report which URL was imported.
const AGENT = new URL('./cdn-agent.mjs', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://')) {
    return { url: AGENT.href + '?url=' + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
