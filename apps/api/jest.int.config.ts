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
    // `jose` ships ESM only; transpile it to CommonJS for Jest (Node runs it natively).
    '^.+/node_modules/jose/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022' }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  // `octokit` is ESM-only; tests never talk to GitHub, so map it to a throwing stub.
  moduleNameMapper: { '^octokit$': '<rootDir>/test/mocks/octokit.ts' },
  globalSetup: '<rootDir>/test/global-setup-int.ts',
  setupFiles: ['<rootDir>/test/setup-int.ts'],
  testTimeout: 30_000,
};

export default config;
