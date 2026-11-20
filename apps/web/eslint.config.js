import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'public', 'test-results', 'playwright-report'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // state/arbitraries.ts, state/paw-session-test-support.ts and api/api-test-support.ts are test support. App code must never import them.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/state/arbitraries.ts',
      'src/state/paw-session-test-support.ts',
      'src/api/api-test-support.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/arbitraries',
            '**/arbitraries.ts',
            '**/api-test-support',
            '**/api-test-support.ts',
            '**/paw-session-test-support',
            '**/paw-session-test-support.ts',
          ],
        },
      ],
    },
  },
);
