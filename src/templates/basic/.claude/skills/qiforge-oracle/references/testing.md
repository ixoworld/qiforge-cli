# Testing

## Layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Type check | `pnpm typecheck` | the oracle and its plugins compile against the runtime's types |
| Unit (workerd) | `pnpm test` | plugins, tools and the prompt contract, inside workerd |
| Bundle | `pnpm run build` | both scripts bundle with their aliases (`wrangler deploy --dry-run`) |
| Local run | `pnpm dev`, then `curl localhost:8787/health` | the Worker boots and loads its plugins |

## How the unit tests run

`vitest.config.ts` uses `@cloudflare/vitest-plugin` (the successor of `@cloudflare/vitest-pool-workers`): tests execute inside workerd, the runtime the oracle ships on. Plain Node cannot load `@ixo/oracle-runtime-workers` (it imports `cloudflare:workers` and build-time WASM modules). The pool reads `test/wrangler.test.jsonc` (no bindings) and mirrors the wrangler aliases in `resolve.alias`.

There is no `createTestRuntime` on Workers. Test a plugin directly:

```ts
import type { PluginContext } from '@ixo/oracle-runtime-workers';
import { describe, expect, it } from 'vitest';
import { ClimatePlugin, lookupClimate } from './climate.plugin';

const pluginContext: PluginContext = {
  config: { CLIMATE_API_URL: 'https://climate.example' },
  identity: { name: 'Test', org: 'Test', description: '', entityDid: 'did:ixo:entity:00000000000000000000000000000000' },
  availablePlugins: new Set(['climate']),
  logger: { log() {}, warn() {}, error() {} },
};

describe('ClimatePlugin', () => {
  it('exposes its tools', () => {
    expect(new ClimatePlugin().getTools(pluginContext).map((t) => t.name)).toEqual(['get_climate']);
  });

  it('validates input with its schema', () => {
    const [tool] = new ClimatePlugin().getTools(pluginContext);
    expect(tool?.schema.safeParse({}).success).toBe(false);
  });

  it('computes the result', async () => {
    expect(await lookupClimate('Berlin', fakeFetch)).toEqual({ city: 'Berlin', tempC: 12 });
  });
});
```

Keep the tool's logic in an exported function that takes its dependencies (a `fetch`, a clock) as parameters; test that function, and test the wiring (tool names, schemas, manifest) through the plugin. A tool handler's second argument is the full per-turn `RuntimeContext`; don't fake it with casts — move what the handler needs into the function's parameters instead.

`src/config.test.ts` composes the whole system prompt with `@ixo/oracle-runtime-workers/prompt` and checks the oracle's slots land in it. Add assertions there for prompt rules that must hold.

## Rules

- Run every test you write; done means green.
- Don't loosen an assertion to make a failure go away — find the cause.
- Integration tests against real services throw on missing configuration; they don't skip silently.
- `vi.mock` of npm modules is not served by the workerd pool's module fallback; inject dependencies instead.
