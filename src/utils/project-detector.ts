import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface DetectedProject {
  /** Absolute path to the project root (directory containing package.json). */
  root: string;
  /** Parsed package.json. */
  pkg: Record<string, unknown>;
}

/** The runtime a scaffolded oracle depends on. */
export const WORKERS_RUNTIME_PACKAGE = '@ixo/oracle-runtime-workers';
/** The deprecated Node runtime — recognised only to point its users at the Workers runtime. */
const NODE_RUNTIME_PACKAGE = '@ixo/oracle-runtime';

/**
 * Walk up from `startDir` looking for a `package.json` that depends on
 * `@ixo/oracle-runtime-workers` (in `dependencies`, `devDependencies`, or
 * `peerDependencies`). Throws with a clear message if not found, or if the
 * project is on the deprecated Node runtime.
 */
export function detectOracleProject(startDir: string): DetectedProject {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      if (hasDep(pkg, WORKERS_RUNTIME_PACKAGE)) {
        return { root: dir, pkg };
      }
      if (hasDep(pkg, NODE_RUNTIME_PACKAGE)) {
        throw new Error(
          `${pkgPath} depends on ${NODE_RUNTIME_PACKAGE}, the deprecated Node runtime. ` +
            `The CLI scaffolds plugins for ${WORKERS_RUNTIME_PACKAGE} only — move the oracle to the Workers runtime ` +
            `(see \`qiforge-cli new\`) first.`,
        );
      }
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  throw new Error(
    `Could not find an oracle project (no package.json with a ${WORKERS_RUNTIME_PACKAGE} dependency found from ${startDir} upward). ` +
      `Run this command inside an oracle project directory or pass --cwd.`,
  );
}

function hasDep(pkg: Record<string, unknown>, name: string): boolean {
  const buckets: ReadonlyArray<keyof typeof pkg> = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ];
  for (const key of buckets) {
    const deps = pkg[key];
    if (deps && typeof deps === 'object' && name in deps) {
      return true;
    }
  }
  return false;
}

/**
 * Names taken by plugins shipped in `@ixo/oracle-runtime-workers` — the
 * bundled set (`BUNDLED_WORKERS_PLUGINS`) and the exported opt-in ones
 * (flows, ixo-transaction, skills, weather, yoma). Hardcoded so the CLI does
 * not load the runtime to validate a name; keep in sync with the runtime's
 * `src/plugins/index.ts` and `src/core/plugins/`.
 */
export const RESERVED_PLUGIN_NAMES: ReadonlySet<string> = new Set([
  'action-proposals',
  'agui',
  'attachments',
  'composio',
  'domain-indexer',
  'editor',
  'firecrawl',
  'flows',
  'hub-actions',
  'ixo-chain',
  'ixo-transaction',
  'matrix-group-chats',
  'memory',
  'pod-creator',
  'portal',
  'sandbox',
  'skills',
  'tasks',
  'user-preferences',
  'vfs',
  'weather',
  'yoma',
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
