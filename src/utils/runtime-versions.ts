/**
 * The package versions a scaffolded oracle pins.
 *
 * The runtime is pinned to one exact, verified release instead of npm
 * `latest`: it is pre-1.0, minors have changed what the wrangler config must
 * declare, and a bad release can sit on `latest` (0.36.0 shipped a change
 * that 0.36.1 reverted). A new runtime release reaches scaffolds through a
 * CLI release that re-runs the end-to-end check (docs/DEVELOPMENT.md).
 *
 * Every companion version is taken from that release's published manifest
 * (`scaffoldVersionsFromManifest`; the unit test holds the manifest fields):
 *
 * - `@ixo/matrix-bot-workers-sdk`, which the scaffold depends on directly
 *   because wrangler resolves the crypto-wasm alias from the project root —
 *   it must be the exact version the runtime pins, or the bundle carries two
 *   copies of the bot SDK;
 * - `zod`, at the runtime's range, for plugin config and tool schemas;
 * - `wrangler`, `@cloudflare/workers-types` and `vitest`, at the ranges the
 *   runtime itself is built and tested with.
 *
 * The workerd test pool is the one exception: the runtime still builds with
 * `@cloudflare/vitest-pool-workers`, which Cloudflare has deprecated in favour
 * of `@cloudflare/vitest-plugin` (same `cloudflareTest` API). The template
 * pins the maintained package itself (`package.json.tmpl`).
 */

export const RUNTIME_PACKAGE = '@ixo/oracle-runtime-workers';
export const BOT_SDK_PACKAGE = '@ixo/matrix-bot-workers-sdk';

export interface ScaffoldVersions {
  runtimeVersion: string;
  botSdkVersion: string;
  zodVersion: string;
  wranglerVersion: string;
  workersTypesVersion: string;
  vitestVersion: string;
}

/**
 * `@ixo/oracle-runtime-workers` 0.37.0 and its companions. 0.37.0 carries the
 * long-thread isolate-memory fixes (one tools node per message, one-shot
 * gzip in the checkpointer, Latin-1 literals so a minified bundle's source
 * costs one byte per character). Never 0.36.0: it contains the reverted #449.
 */
export const SCAFFOLD_VERSIONS: ScaffoldVersions = {
  runtimeVersion: '0.37.0',
  botSdkVersion: '0.7.0',
  zodVersion: '^4.4.3',
  wranglerVersion: '^4.125.0',
  workersTypesVersion: '^5.20260825.1',
  vitestVersion: '^4.0.0',
};

export interface RuntimeManifest {
  version?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${RUNTIME_PACKAGE} manifest has no ${what}`);
  }
  return value;
}

/**
 * Derive the scaffold versions from a published runtime manifest (what
 * `npm view @ixo/oracle-runtime-workers@<version> --json` prints). Used when
 * moving `SCAFFOLD_VERSIONS` to a new runtime release. Throws on a malformed
 * manifest.
 */
export function scaffoldVersionsFromManifest(manifest: RuntimeManifest): ScaffoldVersions {
  const deps = manifest.dependencies ?? {};
  const devDeps = manifest.devDependencies ?? {};
  return {
    runtimeVersion: requireString(manifest.version, 'version'),
    botSdkVersion: requireString(deps[BOT_SDK_PACKAGE], `dependencies["${BOT_SDK_PACKAGE}"]`),
    zodVersion: requireString(deps.zod, 'dependencies["zod"]'),
    wranglerVersion: requireString(devDeps.wrangler, 'devDependencies["wrangler"]'),
    workersTypesVersion: requireString(
      devDeps['@cloudflare/workers-types'],
      'devDependencies["@cloudflare/workers-types"]',
    ),
    vitestVersion: requireString(devDeps.vitest, 'devDependencies["vitest"]'),
  };
}
