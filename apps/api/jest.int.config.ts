import type { Config } from 'jest';

/**
 * Integration tests: real Postgres (DATABASE_URL_TEST, migrated in globalSetup) + Redis.
 * Run serially (`--runInBand`) because tests share one database that is truncated per test.
 */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      // 151002: ts-jest notice about module "nodenext"; output is CommonJS either way.
      { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
    // `jose`, `@octokit/*` and their helpers ship ESM only; transpile them to CommonJS for Jest
    // (Node runs them natively via require(esm)). Tests intercept `fetch`, never the real GitHub.
    '^.+/node_modules/(jose|@octokit|before-after-hook|universal-user-agent)/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022' }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(jose|@octokit|before-after-hook|universal-user-agent)/)',
  ],
  globalSetup: '<rootDir>/test/global-setup-int.ts',
  setupFiles: ['<rootDir>/test/setup-int.ts'],
  testTimeout: 30_000,
};

export default config;
