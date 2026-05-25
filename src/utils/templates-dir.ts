import { existsSync } from 'fs';
import path from 'path';

/**
 * Resolve the bundled templates directory.
 *
 * In the published CLI, esbuild bundles `src/cli.ts` → `dist/cli.js` and
 * `build.mjs` copies `src/templates/**` → `dist/templates/**`. So at runtime
 * `__dirname` is `<install>/dist` and templates live at `<install>/dist/templates`.
 *
 * In dev (ts-jest), the file lives at `src/<…>/…ts`, so we probe upward
 * for `src/templates`. Throws if neither is found.
 */
export function getTemplatesDir(fromDir: string): string {
  const candidates = [
    path.join(fromDir, 'templates'),
    path.resolve(fromDir, '..', 'templates'),
    path.resolve(fromDir, '..', '..', 'templates'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not locate templates directory. Tried: ${candidates.join(', ')}`,
  );
}
