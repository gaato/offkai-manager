import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.svelte-kit/**',
      'build/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'e2e/legacy-reference/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'svelte/no-navigation-without-resolve': 'off'
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['src/**/*.{ts,svelte}'],
    ignores: ['src/lib/server/time/**', 'src/lib/shared/money/**'],
    rules: {
      'no-restricted-globals': ['error', { name: 'Intl', message: 'Use src/lib/server/time.' }],
      'no-restricted-properties': [
        'error',
        { property: 'toLocaleString', message: 'Use src/lib/server/time.' },
        { property: 'toLocaleDateString', message: 'Use src/lib/server/time.' },
        { property: 'toLocaleTimeString', message: 'Use src/lib/server/time.' }
      ]
    }
  },
  prettier
);
