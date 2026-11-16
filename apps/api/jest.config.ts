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
    // `jose` ships ESM only; transpile it to CommonJS for Jest (Node runs it natively).
    '^.+/node_modules/jose/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022' }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  // `octokit` is ESM-only; tests never talk to GitHub, so map it to a throwing stub.
  moduleNameMapper: { '^octokit$': '<rootDir>/test/mocks/octokit.ts' },
  setupFiles: ['<rootDir>/test/setup-unit.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/worker.ts'],
  clearMocks: true,
};

export default config;
