import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/tests/**/*.test.ts'],
    // Unit/smoke tests run in Node.js — no Workers environment needed.
    // Integration tests requiring Workers will use a separate config.
  },
});
