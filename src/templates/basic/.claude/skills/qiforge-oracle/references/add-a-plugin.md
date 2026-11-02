# Add a plugin

## 1. Scaffold

```bash
qiforge-cli plugin new climate
```

Creates `src/plugins/climate/`:

```
climate.plugin.ts        # OraclePlugin subclass with one sample tool (climate_echo)
climate.plugin.test.ts   # three tests, run inside workerd
README-climate.md
fixtures/
```

The name must be kebab-case and must not collide with a plugin the runtime ships (memory, sandbox, firecrawl, domain-indexer, composio, vfs, tasks, editor, user-preferences, portal, agui, attachments, matrix-group-chats, pod-creator, ixo-chain, action-proposals, hub-actions, flows, ixo-transaction, skills, weather, yoma).

## 2. Register it

Plugins are not discovered; pass every one to `createOracleWorker` in `src/index.ts`:

```ts
import { BUNDLED_WORKERS_PLUGINS, createOracleWorker } from '@ixo/oracle-runtime-workers';
import { ClimatePlugin } from './plugins/climate/climate.plugin';

const oracle = createOracleWorker({
  config,
  plugins: [...BUNDLED_WORKERS_PLUGINS, new ClimatePlugin()],
});
```

## 3. Give it configuration

Declare env vars in the plugin's `configSchema`; the runtime merges it into the env schema it validates at boot and hands the parsed values back as `ctx.config`:

```ts
const configSchema = z.object({
  CLIMATE_API_URL: z.string().url(),
  CLIMATE_API_KEY: z.string().min(1),
});

override autoDetect(env: PluginEnv): boolean {
  // Leave the plugin out when its key is absent instead of failing the boot.
  return typeof env.CLIMATE_API_KEY === 'string' && env.CLIMATE_API_KEY.length > 0;
}
override readonly autoDetectHint = 'CLIMATE_API_KEY';
```

Then set the values: non-secret ones in the `vars` of `wrangler.jsonc`, secrets in `.dev.vars` (local) and `pnpm exec wrangler secret put CLIMATE_API_KEY` (deployed). See `env-vars.md`.

## 4. Replace the sample tool, write the manifest

Write real `summary`, `whenToUse`, `whenNotToUse` and `examples` — they are what the agent reads to decide whether to load the plugin. See `add-a-tool.md` for every hook.

## 5. Test

```bash
pnpm test src/plugins/climate
pnpm typecheck
```

Tests run inside workerd (`vitest.config.ts`); see `testing.md`.

## 6. Run it

```bash
pnpm dev
```

The boot log lists every loaded and excluded plugin with the reason: `[boot] oracle '<name>' loaded plugins: [...] excluded: [...]`.
