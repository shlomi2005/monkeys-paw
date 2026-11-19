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
    // state/arbitraries.ts is test support (fast-check). App code must never import it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/state/arbitraries.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/arbitraries', '**/arbitraries.ts'] }],
    },
  },
);
