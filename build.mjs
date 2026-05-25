import { build } from 'esbuild';
import { cpSync, rmSync } from 'fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: 'dist/cli.js',
  minify: true,
  sourcemap: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "module";',
      'const require = __createRequire(import.meta.url);',
      'const __filename = import.meta.filename;',
      'const __dirname = import.meta.dirname;',
    ].join('\n'),
  },
  external: ['@matrix-org/matrix-sdk-crypto-wasm', 'qrcode-terminal'],
});

// esbuild doesn't touch non-JS assets. The CLI looks up templates relative
// to its own dist directory via `getTemplatesDir(__dirname)`, so the source
// tree at `src/templates/**` has to land at `dist/templates/**`.
cpSync('src/templates', 'dist/templates', { recursive: true });

console.log('Build complete: dist/cli.js (+ dist/templates/)');
