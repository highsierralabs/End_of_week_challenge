// Style plus one module boundary: src/physics is pure and deterministic
// (it runs in a worker and in unit tests), so it never touches three, the DOM or clocks.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'shots/**', 'test-results/**', 'public/**'] },
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
    files: ['src/physics/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^three(/|$)', message: 'physics is pure: no three.' },
        { regex: '^(\\.\\./)+(render|ui|app|data)(/|$)', message: 'physics imports only physics.' },
      ] }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'physics is deterministic: use physics/rng.ts.' },
        { object: 'Date', property: 'now', message: 'physics is pure: no clocks.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', Buffer: 'readonly' } },
  },
);
