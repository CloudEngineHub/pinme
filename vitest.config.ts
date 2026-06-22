import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'test/**/*.{test,spec}.ts',
      'test/**/*.{test,spec}.mjs',
      'tests/**/*.{test,spec}.mjs',
    ],
    exclude: ['node_modules', 'dist', 'coverage', 'reports', '.stryker-tmp'],
    setupFiles: ['test/setup/nock.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Keep the coverage gate on in-process core modules. Command files are
      // exercised by test:cli against the bundled CLI; that subprocess coverage
      // is not reliably attributed back to TypeScript source files.
      include: [
        'bin/utils/domainValidator.ts',
        'bin/utils/config.ts',
        'bin/utils/uploadLimits.ts',
        'bin/utils/apiClient.ts',
        'bin/utils/cliError.ts',
        'bin/utils/history.ts',
        'bin/utils/pinmeApi.ts',
        'bin/utils/webLogin.ts',
        'bin/services/uploadService.ts',
      ],
      exclude: [
        // Login callback/browser UI and CLI entrypoints are covered by CLI tests.
        'bin/index.ts',
        'bin/login.ts',
      ],
      statements: 85,
      branches: 80,
      functions: 85,
      lines: 85,
    },
  },
});
