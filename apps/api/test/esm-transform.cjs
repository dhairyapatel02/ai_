// Jest transformer for ESM-only node_modules that TypeScript can't convert (they use
// `import.meta.url`): `@react-pdf/*` and its dependencies. esbuild rewrites them to CommonJS.
const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    const { code, map } = transformSync(source, {
      loader: 'js',
      format: 'cjs',
      target: 'node22',
      sourcefile: filename,
      sourcemap: 'inline',
      define: { 'import.meta.url': '__jestImportMetaUrl' },
      banner: "const __jestImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
      logLevel: 'silent',
    });
    return { code, map };
  },
};
