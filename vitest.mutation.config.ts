import { mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, {
  test: {
    include: [
      'test/unit/**/*.{test,spec}.ts',
      'test/integration/**/*.{test,spec}.ts',
      'test/login-tracking-source.test.mjs',
      'tests/**/*.{test,spec}.mjs',
    ],
    exclude: [
      'node_modules',
      'dist',
      'coverage',
      'reports',
      '.stryker-tmp',
      'test/cli/**',
      'test/pack/**',
    ],
  },
});
