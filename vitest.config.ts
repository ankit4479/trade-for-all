import { defineConfig } from 'vitest/config';

// Minimal, node-environment config for server-side unit tests. We deliberately
// do NOT reuse vite.config.ts (react + tailwind plugins) — these tests exercise
// pure functions in server/api/* and need no browser/JSX transform. Scoped to
// the server test folder so frontend code is never pulled in.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
  },
});
