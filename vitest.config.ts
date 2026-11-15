import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
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
