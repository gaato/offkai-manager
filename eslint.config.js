import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import functional from 'eslint-plugin-functional';
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
  {
    files: ['**/*.{ts,js,mjs,svelte}'],
    ignores: ['src/lib/server/db/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression > MemberExpression.callee[property.name='transaction'], CallExpression > MemberExpression.callee[computed=true][property.value='transaction']",
          message:
            'Use read/write from server/db/client so async callbacks cannot commit at their first await.'
        }
      ]
    }
  },
  {
    files: ['src/lib/server/{domain,worker}/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression > MemberExpression.callee[property.name='transaction'], CallExpression > MemberExpression.callee[computed=true][property.value='transaction']",
          message:
            'Use read/write from server/db/client so async callbacks cannot commit at their first await.'
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock so domain and worker time is deterministic.'
        },
        {
          selector:
            "MemberExpression[object.name='Date'][property.name='now'], MemberExpression[object.name='Math'][property.name='random']",
          message: 'Inject time and randomness so domain behavior is reproducible.'
        }
      ]
    }
  },
  {
    files: ['src/lib/server/domain/**/core/**/*.ts'],
    plugins: { functional },
    rules: {
      'functional/no-let': 'error',
      'functional/immutable-data': 'error',
      'functional/no-loop-statements': 'error'
    }
  },
  prettier
);
