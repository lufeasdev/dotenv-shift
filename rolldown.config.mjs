import { defineConfig } from 'rolldown';

// `vsce package` runs the `vscode:prepublish` script: ship a minified build without sourcemaps.
const production = process.env.npm_lifecycle_event === 'vscode:prepublish';

export default defineConfig({
  input: 'src/extension.ts',
  platform: 'node',
  external: ['vscode'],
  // Prefer ES module builds: UMD builds (e.g. jsonc-parser's) load their parts with dynamic
  // require() calls the bundler can't follow.
  resolve: { mainFields: ['module', 'main'] },
  output: {
    file: 'dist/extension.js',
    format: 'cjs',
    sourcemap: !production,
    minify: production,
  },
});
