import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts', './src/__tests__/setup-jest-dom.ts'],
    globals: true,
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.claude/**'],
    // SQLite only supports a single writer at a time. Several integration tests
    // hit the real database via Prisma/libSQL, so running test files in parallel
    // causes SocketTimeout / "Operation has timed out" errors from lock contention.
    // Disabling file parallelism eliminates the flakiness with minimal impact on
    // total runtime (~30s parallel vs ~35s sequential on typical hardware).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
