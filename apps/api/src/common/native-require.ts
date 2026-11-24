/**
 * A `require` resolved from `from`, for lazily loaded dependencies. In production Node 22 loads
 * ESM-only packages (`@react-pdf/renderer`) through `require(esm)`; under Jest this goes through
 * Jest's registry, which transpiles those packages (jest config `transformIgnorePatterns`).
 */
export function nativeRequire(from: string): NodeJS.Require {
  return process.getBuiltinModule('node:module').createRequire(from);
}
