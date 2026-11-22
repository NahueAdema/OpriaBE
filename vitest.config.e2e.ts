import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Dev and prod share a remote Neon database; allow for network latency.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://opria:opria@127.0.0.1:5433/opria_test',
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET ??
        'test-secret-with-at-least-32-characters!!',
    },
  },
});
