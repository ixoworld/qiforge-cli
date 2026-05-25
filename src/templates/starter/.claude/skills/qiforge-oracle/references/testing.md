# Testing plugins

The runtime ships `createTestRuntime` for fast, isolated plugin tests — no Nest boot, no real LLM, no Matrix. Use it for unit tests; reserve integration tests (real boot, real LLM) for whole-oracle scenarios.

Imports come from the runtime's `/testing` subpath:

```ts
import { createTestRuntime } from '@ixo/oracle-runtime/testing';
```

## Three tests every plugin should have

This is the shape `qiforge-cli plugin new <name>` generates:

```ts
import { createTestRuntime } from '@ixo/oracle-runtime/testing';
import { describe, expect, it } from 'vitest';
import { ClimatePlugin } from './climate.plugin.js';

describe('ClimatePlugin', () => {
  it('boots without error', async () => {
    const rt = await createTestRuntime({ plugins: [new ClimatePlugin()] });
    expect(rt.listTools().map((t) => t.name)).toContain('get_emissions');
    await rt.close();
  });

  it('returns expected data for a known facility', async () => {
    const rt = await createTestRuntime({ plugins: [new ClimatePlugin()] });
    const result = await rt.invokeTool('get_emissions', { facilityId: 'plant-42' });
    expect(result).toMatchObject({ scope1: expect.any(Number) });
    await rt.close();
  });

  it('matches the manifest snapshot', () => {
    expect(new ClimatePlugin().manifest).toMatchSnapshot();
  });
});
```

## Calling tools and middlewares

```ts
const rt = await createTestRuntime({ plugins: [new MyPlugin()] });

// Invoke a tool
await rt.invokeTool('get_emissions', { facilityId: 'plant-42' });

// Inspect what's registered
rt.listTools();
rt.listCapabilities();

// Trigger a middleware in isolation
await rt.invokeMiddleware('weather-logger', { messages: [] });

await rt.close();
```

## Supplying config / fetch mocks

```ts
const rt = await createTestRuntime({
  plugins: [new ClimatePlugin()],
  config: {
    CLIMATE_API_URL: 'https://api.test',
    CLIMATE_API_KEY: 'test-key',
  },
  mocks: {
    fetch: async (req) => {
      if (req.url.endsWith('/emissions/plant-42')) {
        return new Response(JSON.stringify({ scope1: 1234 }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  },
});
```

## Overriding user / session

When a tool reads `rtCtx.user` or `rtCtx.session`:

```ts
const rt = await createTestRuntime({
  plugins: [new MyPlugin()],
  user: { did: 'did:ixo:user:abc', timezone: 'Europe/Berlin' },
  session: { id: 'sess-1' },
});
```

## What `createTestRuntime` does NOT do

- **No Nest boot** — `getNestModules` plugins still register, but routes aren't reachable. Test those with integration tests.
- **No real LLM** — `mocks.llm.respondWith` returns canned strings. Don't assert on the LLM's exact wording.
- **No real Matrix** — `mocks.matrix` returns canned responses.
- **No checkpointer persistence** — state is in-memory and dies with `rt.close()`.

Use it where it's cheap and deterministic; reach for integration tests when you need the real graph + real services.

## Running tests

```bash
pnpm test                          # all
pnpm test src/plugins/<name>       # one plugin
pnpm test --watch                  # watch mode during dev
```

The starter is wired with vitest. The unit-test glob picks up `*.test.ts` under `src/` and `test/`.

## Source of truth

- https://docs.ixo.world/build-an-oracle/build/test-your-oracle
