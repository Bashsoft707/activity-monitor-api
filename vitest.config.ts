import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],

    // Must run before any test file imports src/env.ts, which reads DATABASE_URL
    // at module load.
    setupFiles: ['./tests/setup/test-env.ts'],

    // The integration suites share one database and truncate between tests, so
    // running files concurrently would have them delete each other's rows.
    fileParallelism: false,

    // Socket handshakes and a remote database are slower than in-process asserts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
