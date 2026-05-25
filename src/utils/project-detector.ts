import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface DetectedProject {
  /** Absolute path to the project root (directory containing package.json). */
  root: string;
  /** Parsed package.json. */
  pkg: Record<string, unknown>;
}

/**
 * Walk up from `startDir` looking for a `package.json` that depends on
 * `@ixo/oracle-runtime` (in `dependencies`, `devDependencies`, or
 * `peerDependencies`). Throws with a clear message if not found.
 */
export function detectOracleProject(startDir: string): DetectedProject {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      if (hasRuntimeDep(pkg)) {
        return { root: dir, pkg };
      }
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  throw new Error(
    `Could not find an oracle project (no package.json with @ixo/oracle-runtime dep found from ${startDir} upward). ` +
      `Run this command inside an oracle project directory or pass --cwd.`,
  );
}

function hasRuntimeDep(pkg: Record<string, unknown>): boolean {
  const buckets: ReadonlyArray<keyof typeof pkg> = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ];
  for (const key of buckets) {
    const deps = pkg[key];
    if (deps && typeof deps === 'object' && '@ixo/oracle-runtime' in deps) {
      return true;
    }
  }
  return false;
}

/**
 * Names taken by bundled plugins shipped from `@ixo/oracle-runtime`. Hardcoded
 * here so the CLI doesn't need to dynamically load the runtime just to validate
 * a plugin name. Keep in sync with `packages/oracle-runtime/src/plugins/index.ts`.
 */
export const RESERVED_PLUGIN_NAMES: ReadonlySet<string> = new Set([
  'memory',
  'portal',
  'firecrawl',
  'domain-indexer',
  'composio',
  'sandbox',
  'skills',
  'editor',
  'agui',
  'slack',
  'tasks',
  'credits',
  'calls',
  'user-preferences',
]);

/** Plugin name validator. kebab-case, starts with letter, 2–40 chars. */
export function validatePluginName(name: string): string | undefined {
  if (!name) return 'Plugin name is required';
  if (name.length < 2 || name.length > 40) return 'Plugin name must be 2–40 characters';
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return 'Plugin name must be kebab-case (lowercase letters, digits, hyphens), start with a letter, and end with a letter or digit';
  }
  if (RESERVED_PLUGIN_NAMES.has(name)) {
    return `"${name}" collides with a bundled plugin. Pick a different name.`;
  }
  return undefined;
}
