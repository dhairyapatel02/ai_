import type { Config } from 'jest';

/** Unit tests: fast, no database/Redis. Co-located `src/**\/*.spec.ts` + `test/unit`. */
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'],
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
  setupFiles: ['<rootDir>/test/setup-unit.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
  clearMocks: true,
};

export default config;
