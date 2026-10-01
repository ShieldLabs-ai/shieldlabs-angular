// Loader tests: the real load() of @shieldlabs-ai/js runs a native import() of the agent URL. These
// module hooks make Node.js answer it with a local stand-in for the agent (test/support/cdn-agent.mjs).
import { register } from 'node:module';

register('../support/cdn-hooks.mjs', import.meta.url);
