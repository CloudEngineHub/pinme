module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['prettier'],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'reports/',
    '.stryker-tmp/',
  ],
  rules: {},
  overrides: [
    {
      files: ['*.mjs'],
      parser: 'espree',
    },
  ],
};
