import {
  type RuntimeManifest,
  SCAFFOLD_VERSIONS,
  scaffoldVersionsFromManifest,
} from '../utils/runtime-versions';

/**
 * The fields of `npm view @ixo/oracle-runtime-workers@0.37.0 --json` the
 * scaffold reads (checked against the registry on 2026-11-02). Moving the
 * scaffold to a new runtime release means replacing this with that release's
 * manifest fields and re-running the end-to-end check.
 */
const RUNTIME_0_37_0_MANIFEST: RuntimeManifest = {
  version: '0.37.0',
  dependencies: {
    '@ixo/matrix-bot-workers-sdk': '0.7.0',
    zod: '^4.4.3',
    yjs: '13.6.32',
    langsmith: '^0.6.0',
  },
  devDependencies: {
    vitest: '^4.0.0',
    wrangler: '^4.125.0',
    '@cloudflare/workers-types': '^5.20260825.1',
    '@cloudflare/vitest-pool-workers': '^0.22.0',
  },
};

describe('SCAFFOLD_VERSIONS', () => {
  it('is derived from the pinned runtime release manifest', () => {
    expect(SCAFFOLD_VERSIONS).toEqual(scaffoldVersionsFromManifest(RUNTIME_0_37_0_MANIFEST));
  });

  it('pins the runtime exactly, never to a range or to 0.36.0', () => {
    expect(SCAFFOLD_VERSIONS.runtimeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SCAFFOLD_VERSIONS.runtimeVersion).not.toBe('0.36.0');
    expect(SCAFFOLD_VERSIONS.botSdkVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('scaffoldVersionsFromManifest', () => {
  it('throws when the manifest lacks the bot SDK', () => {
    expect(() =>
      scaffoldVersionsFromManifest({ ...RUNTIME_0_37_0_MANIFEST, dependencies: { zod: '^4.4.3' } }),
    ).toThrow(/@ixo\/matrix-bot-workers-sdk/);
  });

  it('throws when the manifest lacks wrangler', () => {
    expect(() =>
      scaffoldVersionsFromManifest({ ...RUNTIME_0_37_0_MANIFEST, devDependencies: {} }),
    ).toThrow(/wrangler/);
  });
});
