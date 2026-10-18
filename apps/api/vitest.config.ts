import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Cada arquivo sobe um PGlite (Postgres em WASM) e aplica as migrações reais.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
