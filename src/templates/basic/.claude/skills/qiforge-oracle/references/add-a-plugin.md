# Add a new plugin

The end goal: a working plugin under `src/plugins/<name>/`, registered in `src/main.ts`, with a green test.

## Step 1 — scaffold

```bash
qiforge-cli plugin new <name>
```

`<name>` must be kebab-case (lowercase letters / digits / hyphens, starts with a letter). The CLI rejects names that collide with bundled plugins (`memory`, `tasks`, `skills`, `firecrawl`, `editor`, `langfuse`, `slack`, `composio`, `credits`, `domain-indexer`, `portal`, `sandbox`, `user-preferences`, `agui`, `calls`).

This produces:

```
src/plugins/<name>/
├── <name>.plugin.ts          # OraclePlugin subclass with one sample tool
├── <name>.plugin.test.ts     # three vitest tests via createTestRuntime
├── README-<name>.md          # doc stub mirroring the manifest
└── fixtures/                 # for test fixtures (empty)
```

## Step 2 — register

The CLI prints the exact snippet. Add to `src/main.ts`:

```ts
import { <NameClass>Plugin } from './plugins/<name>/<name>.plugin.js';

await createOracleApp({
  config,
  plugins: [
    /* …existing plugins… */
    new <NameClass>Plugin(),
  ],
});
```

The `.js` extension is required — this is an ESM project.

## Step 3 — flesh out the manifest

The sample manifest is a stub. Replace the placeholders with the real intent:

```ts
const manifest: PluginManifest = {
  title: 'Climate',
  summary: 'Lookup carbon-emissions data for facilities by facility ID.',
  whenToUse: [
    'User asks about a facility\'s carbon emissions, scope-1/2/3 totals, or year-over-year change.',
    'User asks for a comparison between facilities.',
  ],
  whenNotToUse: [
    'Questions about climate policy or news (use web search instead).',
  ],
  examples: [
    { user: "What were Plant 42's emissions in 2024?", tool: 'get_emissions', args: { facilityId: 'plant-42', year: 2024 } },
  ],
  tags: ['climate', 'emissions', 'facility'],
  category: 'data',
  visibility: 'on-demand',     // default — load when needed
  stability: 'experimental',
};
```

The agent uses `whenToUse` to decide when to load this plugin. Write triggers as concrete user-intent phrases, not abstract capabilities.

## Step 4 — replace the sample tool

The scaffold ships with `<name_camel>_echo`. Replace it with the real capability. Use the `tool()` helper:

```ts
override getTools(ctx: PluginContext): PluginTool[] {
  return [
    tool(
      async (args, rtCtx) => {
        const { facilityId, year } = args as { facilityId: string; year?: number };
        return fetchEmissions(facilityId, year, ctx.config.CLIMATE_API_URL);
      },
      {
        name: 'get_emissions',
        description: 'Fetch carbon emissions for a facility by ID.',
        schema: z.object({
          facilityId: z.string().describe('Facility identifier, e.g. "plant-42".'),
          year: z.number().int().optional().describe('Year (default: latest).'),
        }),
      },
    ),
  ];
}
```

Recipes for the other hooks (sub-agent, middleware, HTTP, shared state, deps) live in `add-a-tool.md`.

## Step 5 — declare env vars

If the plugin needs an API key or endpoint, declare it in `configSchema`:

```ts
const configSchema = z.object({
  CLIMATE_API_URL: z.string().url(),
  CLIMATE_API_KEY: z.string().min(1),
});
```

The runtime merges this into the composed env schema and validates `process.env` at boot. Add the keys to `.env.example` so consumers know what to set.

If the plugin should only load when its env is present, gate it via `autoDetect`:

```ts
override autoDetect(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CLIMATE_API_URL && env.CLIMATE_API_KEY);
}
override readonly autoDetectHint = 'CLIMATE_API_URL + CLIMATE_API_KEY';
```

Read more in `env-vars.md`.

## Step 6 — update the tests

The scaffold's three tests cover the sample tool. Rewrite them to exercise the real behavior. See `testing.md` for `createTestRuntime` patterns.

```bash
pnpm test src/plugins/<name>
```

Don't claim the work as done until tests pass.

## Source of truth

- https://docs.ixo.world/build-an-oracle/build/write-a-plugin
- https://docs.ixo.world/build-an-oracle/quickstart
- https://docs.ixo.world/build-an-oracle/for-ai-agents
