// @ts-check
// Root ESLint flat config for the whole monorepo (apps/api, apps/web, packages/shared, e2e).
import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'apps/api/prisma/migrations/**',
      // Phase 01 audit scripts are archived evidence, not maintained code.
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', '*.js', 'apps/*/*.js', 'apps/*/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-duplicates': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Template literals with numbers are common and safe for log/prompt strings.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      // Strict boolean/nullish style rules that would force unrelated rewrites of v0.1 code;
      // revisit once the API/UI rewrites (P05/P09) land.
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  // Plain JS config files: no type information.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // CommonJS config files (next.config.js, postcss.config.js) use require().
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // NestJS API
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Nest modules are empty decorated classes by design.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Constructor parameter properties are the Nest DI idiom.
      '@typescript-eslint/parameter-properties': 'off',
    },
  },
  {
    files: ['apps/api/test/**/*.ts', 'apps/api/**/*.spec.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      // Mocks and partial fixtures are intentionally loosely typed in tests.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Next.js web app
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // @next/eslint-plugin-next 14 uses ESLint 8 context APIs; fixupPluginRules shims them for ESLint 9.
    plugins: { '@next/next': fixupPluginRules(nextPlugin), 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // `onClick={asyncHandler}` is idiomatic React; handlers own their error handling.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['apps/web/**/*.test.{ts,tsx}', 'apps/web/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Playwright E2E
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
);
