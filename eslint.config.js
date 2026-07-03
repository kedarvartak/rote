import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Cross-package deep-import restrictions (see CLAUDE.md "Modularity rules":
// public surface goes through index.ts only) will be added once a second
// package exists to enforce the rule against — nothing to restrict yet.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
