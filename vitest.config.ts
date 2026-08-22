import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run test files sequentially. These are hook tests that mutate
    // process-global state — process.env (e.g. CLAUDE_PROJECT_DIR in
    // observe-stop-correlation), the working directory, and shared temp
    // files (the observer failure log, the preflight status file). Under
    // vitest's default parallel file execution they race across the shared
    // worker process, flaking intermittently locally and reliably in CI
    // (different core counts → different scheduling). packages/kanban-viewer's
    // config sets the same flag for the same reason.
    fileParallelism: false,
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
