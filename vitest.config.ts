import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      '**/__tests__/**/*.test.js',
      '**/*.test.js',
      '**/__tests__/**/*.test.ts',
      '**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      'packages/!(shared)/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
