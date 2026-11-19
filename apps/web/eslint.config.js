import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'public'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // state/arbitraries.ts and api/api-test-support.ts are test support. App code must never import them.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/state/arbitraries.ts', 'src/api/api-test-support.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/arbitraries', '**/arbitraries.ts', '**/api-test-support', '**/api-test-support.ts'] },
      ],
    },
  },
);
