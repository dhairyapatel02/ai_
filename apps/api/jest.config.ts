import type { Config } from 'jest';

/** Unit tests: fast, no database/Redis. Co-located `src/**\/*.spec.ts` + `test/unit` + `test/evals`. */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/test/unit/**/*.spec.ts',
    // Mocked AI evals (recorded responses) run with the unit tests in CI (P08).
    '<rootDir>/test/evals/**/*.spec.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      // 151002: ts-jest notice about module "nodenext"; output is CommonJS either way.
      { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
    // `jose`, `@octokit/*`, `@react-pdf/*` and their helpers ship ESM only (no top-level await); transpile them to CommonJS for Jest
    // (Node runs them natively via require(esm)). Tests intercept `fetch`, never the real GitHub.
    '^.+/node_modules/(jose|@octokit|before-after-hook|universal-user-agent)/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022' }, diagnostics: false },
    ],
    // `@react-pdf/*` (PDF exports, P11) and its ESM-only dependencies use `import.meta.url`.
    '^.+/node_modules/(@react-pdf|@swc/helpers|fontkit|restructure|unicode-properties|linebreak|png-js|jay-peg|yoga-layout|color-string|color-name)/.+\\.js$':
      '<rootDir>/test/esm-transform.cjs',
  },
  // `@react-pdf/hyphenate` only exports an `import` condition; Jest resolves with `require`.
  moduleNameMapper: {
    '^@react-pdf/hyphenate$': '<rootDir>/../../node_modules/@react-pdf/hyphenate/lib/index.js',
    '^@react-pdf/hyphenate/(.*)$': '<rootDir>/../../node_modules/@react-pdf/hyphenate/lib/$1.js',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(jose|@octokit|before-after-hook|universal-user-agent|@react-pdf|@swc/helpers|fontkit|restructure|unicode-properties|linebreak|png-js|jay-peg|yoga-layout|color-string|color-name)/)',
  ],
  setupFiles: ['<rootDir>/test/setup-unit.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
  clearMocks: true,
};

export default config;
