import {
  FALLBACK_SCAFFOLD_VERSIONS,
  resolveScaffoldVersions,
  scaffoldVersionsFromManifest,
} from '../utils/runtime-versions';

const manifest = {
  version: '0.40.0',
  dependencies: { '@ixo/matrix-bot-workers-sdk': '0.8.1', zod: '^4.5.0' },
  devDependencies: {
    wrangler: '^4.200.0',
    '@cloudflare/workers-types': '^5.20270101.1',
    vitest: '^4.2.0',
  },
};

function fakeFetch(response: Response | Error): typeof fetch {
  return async () => {
    if (response instanceof Error) throw response;
    return response;
  };
}

describe('scaffoldVersionsFromManifest', () => {
  it('pins the runtime exactly and takes every other version from its manifest', () => {
    expect(scaffoldVersionsFromManifest(manifest)).toEqual({
      runtimeVersion: '0.40.0',
      botSdkVersion: '0.8.1',
      zodVersion: '^4.5.0',
      wranglerVersion: '^4.200.0',
      workersTypesVersion: '^5.20270101.1',
      vitestVersion: '^4.2.0',
    });
  });

  it('throws when the manifest lacks the bot SDK', () => {
    expect(() =>
      scaffoldVersionsFromManifest({ ...manifest, dependencies: { zod: '^4.5.0' } }),
    ).toThrow(/@ixo\/matrix-bot-workers-sdk/);
  });
});

describe('resolveScaffoldVersions', () => {
  it('reads the latest manifest from the registry', async () => {
    const result = await resolveScaffoldVersions(fakeFetch(Response.json(manifest)));
    expect(result.fallbackReason).toBeUndefined();
    expect(result.versions.runtimeVersion).toBe('0.40.0');
  });

  it('falls back with a reason when the registry fails', async () => {
    const result = await resolveScaffoldVersions(fakeFetch(new Error('offline')));
    expect(result.versions).toEqual(FALLBACK_SCAFFOLD_VERSIONS);
    expect(result.fallbackReason).toBe('offline');
  });

  it('falls back on a non-OK response', async () => {
    const result = await resolveScaffoldVersions(fakeFetch(new Response('nope', { status: 503 })));
    expect(result.versions).toEqual(FALLBACK_SCAFFOLD_VERSIONS);
    expect(result.fallbackReason).toMatch(/503/);
  });
});
