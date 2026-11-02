/**
 * The package versions a scaffolded oracle pins.
 *
 * Everything is read from the published manifest of `@ixo/oracle-runtime-workers`
 * so the scaffold always matches the runtime it installs:
 *
 * - the runtime itself, pinned exactly (it is pre-1.0; a caret on 0.x still
 *   moves minors, and minors have changed wrangler config requirements);
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
 * Used only when the npm registry cannot be reached: the versions verified
 * together when this CLI release was cut (runtime 0.35.1, November 2026).
 */
export const FALLBACK_SCAFFOLD_VERSIONS: ScaffoldVersions = {
  runtimeVersion: '0.35.1',
  botSdkVersion: '0.7.0',
  zodVersion: '^4.4.3',
  wranglerVersion: '^4.125.0',
  workersTypesVersion: '^5.20260825.1',
  vitestVersion: '^4.0.0',
};

interface RuntimeManifest {
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

/** Derive the scaffold versions from a published runtime manifest. Throws on a malformed one. */
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

const REGISTRY_FETCH_TIMEOUT_MS = 5000;

/**
 * Resolve the scaffold versions from the registry's `latest` manifest of the
 * runtime. On any failure returns the fallback set plus the reason, so the
 * caller can warn and still scaffold.
 */
export async function resolveScaffoldVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<{ versions: ScaffoldVersions; fallbackReason?: string }> {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${RUNTIME_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`registry responded with ${res.status}`);
    const manifest = (await res.json()) as RuntimeManifest;
    return { versions: scaffoldVersionsFromManifest(manifest) };
  } catch (err) {
    return {
      versions: FALLBACK_SCAFFOLD_VERSIONS,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
