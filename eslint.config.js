import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import ignores from './eslint.ignores.js';

// Check behavior across browser, native, server and test code without imposing
// a repository-wide formatting rewrite. Prettier remains available separately.
export default [
  {ignores},
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {ecmaFeatures: {jsx: true}},
    },
    plugins: {'@typescript-eslint': ts.plugin},
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
      'no-restricted-properties': ['error',
        {object: 'describe', property: 'only'},
        {object: 'it', property: 'only'},
        {object: 'test', property: 'only'},
      ],
    },
  },
  {
    files: ['src/**/*.{js,ts}', 'client/**/*.{js,jsx}', 'shared/**/*.js', 'docs/previews/**/*.js'],
    languageOptions: {globals: {...globals.browser, BarcodeDetector: 'readonly', __PUBLIC_ORIGIN__: 'readonly'}},
  },
  {
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.{js,mjs,cjs}', '*.{js,mjs,cjs}'],
    languageOptions: {globals: globals.node},
  },
  {
    files: ['**/*.test.{js,ts,cjs}', 'scripts/browser-*.cjs'],
    languageOptions: {globals: {...globals.node, ...globals.browser}},
  },
  {
    files: ['apps/controller/**/*.{js,jsx,cjs}'],
    languageOptions: {globals: {...globals.node, ...globals.browser, __DEV__: 'readonly'}},
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {parserOptions: {project: './tsconfig.json'}},
    rules: {
      // The compiler resolves TypeScript's type/value namespaces correctly.
      'no-undef': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];
