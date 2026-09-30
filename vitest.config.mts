import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    maxWorkers: 2,
    mockReset: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/public-api.ts', 'src/lib/types.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 90 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['test/**/*.spec.ts'],
          exclude: ['test/**/*.server.spec.ts', 'test/**/*.loader.spec.ts'],
          setupFiles: ['test/setup/browser.ts'],
        },
      },
      {
        // The real @shieldlabs/js loader (not mocked), with the agent module served by Node.js
        // module hooks from a local stand-in.
        extends: true,
        test: {
          name: 'loader',
          environment: 'jsdom',
          include: ['test/**/*.loader.spec.ts'],
          setupFiles: ['test/setup/browser.ts', 'test/setup/cdn-agent.mjs'],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['test/**/*.server.spec.ts'],
          setupFiles: ['test/setup/server.ts'],
        },
      },
    ],
  },
});
