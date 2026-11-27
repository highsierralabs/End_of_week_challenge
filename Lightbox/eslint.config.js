// Style plus one module boundary: src/core is pure and deterministic (it runs in unit tests and
// in workers), so it never touches the DOM, WebGL or clocks.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'shots/**', 'test-results/**', 'public/**', 'data-src/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': ['error', { selector: 'TSEnumDeclaration', message: 'Use an `as const` object, not enum.' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^(\.\./)+(gpu|app|validation)(/|$)', message: 'core imports only core and data.' },
      ] }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'core is deterministic.' },
        { object: 'Date', property: 'now', message: 'core is pure: no clocks.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', Buffer: 'readonly' } },
  },
);
