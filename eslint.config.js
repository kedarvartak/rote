import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    // Plain JS/MJS files (CLI bin shims, test fixture scripts spawned as
    // real child processes) run directly under Node, not through the
    // TS build — give them Node's global ambient bindings.
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // CLAUDE.md "Modularity rules": public surface per package goes through
      // index.ts only — deep imports across @rote packages are banned.
      'no-restricted-imports': [
        'error',
        { patterns: [
          { group: ['@rote/*/*'], message: 'Import from a package\'s public index (e.g. "@rote/core"), not a deep path.' },
          { group: ['@anthropic-ai/sdk', 'openai'], message: 'Provider SDK calls belong in the shared @rote/llm package.' },
        ] },
      ],
    },
  },
  {
    files: ['packages/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@rote/*/*'], message: 'Import from a package\'s public index, not a deep path.' }] },
      ],
    },
  },
);
