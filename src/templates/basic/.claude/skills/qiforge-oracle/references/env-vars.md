# Environment variables

QiForge composes the env schema at boot: base (Tier-0) + every loaded plugin's `configSchema`. Missing required vars fail fast with a clear error naming the plugin that needed them.

## Tier-0 (runtime base)

Required regardless of which plugins you ship. These are validated by the runtime itself.

| Var | Required | What it does |
| --- | --- | --- |
| `ORACLE_ENTITY_DID` | yes | The oracle's IXO entity DID. |
| `ORACLE_MNEMONIC` (or `SECP_MNEMONIC`) | yes | Wallet mnemonic for chain signing. |
| `MATRIX_ORACLE_ADMIN_USER_ID` | yes | Matrix user the bot logs in as. |
| `MATRIX_ORACLE_ADMIN_PASSWORD` | yes | Matrix bot password. |
| `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN` | yes | Matrix access token (rotate periodically). |
| `MATRIX_BASE_URL` | yes | Homeserver URL. |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `OPEN_ROUTER_API_KEY` | yes | At least one LLM provider key. |
| `PORT` | optional | HTTP port (default 3000). |
| `NODE_ENV` | optional | `development` / `production`. |
| `CORS_ORIGIN` | optional | Default `*`. |
| `SQLITE_DATABASE_PATH` | optional | Path for the checkpointer DB. Default `./.data/sqlite`. |
| `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` | optional | Enables LangSmith tracing. |
| `AGENT_CARD_PATH` | optional | Path to the local Agent Card copy, set by `qiforge-cli agent-card` (default `./agent-card.json`). |

## Bundled-plugin env (only loaded plugins read theirs)

| Plugin | Env |
| --- | --- |
| `memory` | `MEMORY_MCP_URL`, `MEMORY_ENGINE_URL` |
| `firecrawl` | `FIRECRAWL_MCP_URL` or `FIRECRAWL_API_KEY` |
| `sandbox` | `SANDBOX_MCP_URL` |
| `composio` | `COMPOSIO_API_KEY` (auto-detected) |
| `slack` | `SLACK_BOT_OAUTH_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_USE_SOCKET_MODE` |
| `tasks` | `REDIS_URL` |
| `credits` | `DISABLE_CREDITS` to opt-out |
| `skills` | `SKILLS_API_URL` (optional) |

For the full grouped list, see `https://docs.ixo.world/build-an-oracle/reference/environment-variables`.

## Adding env vars for YOUR plugin

Always declare via `configSchema` — never read `process.env` directly inside plugin code.

```ts
const configSchema = z.object({
  CLIMATE_API_URL: z.string().url(),
  CLIMATE_API_KEY: z.string().min(1),
  CLIMATE_DEFAULT_YEAR: z.coerce.number().int().default(new Date().getFullYear() - 1),
});

export class ClimatePlugin extends OraclePlugin {
  override readonly configSchema = configSchema;

  override getTools(ctx: PluginContext) {
    const { CLIMATE_API_URL, CLIMATE_API_KEY } = configSchema.parse(ctx.config);
    return [/* tools using these */];
  }
}
```

**Why this matters**:

- Boot-time validation: missing required vars fail with a clear error message naming the plugin.
- `ctx.config` is typed — no string-typing roulette.
- The runtime can show users the full required env (every plugin's vars) in one place.

## Gating plugins on env (`autoDetect`)

If a plugin should only load when its env is present, gate it:

```ts
override autoDetect(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CLIMATE_API_URL && env.CLIMATE_API_KEY);
}
override readonly autoDetectHint = 'CLIMATE_API_URL + CLIMATE_API_KEY';
```

The `autoDetectHint` is surfaced in boot logs (`✗ climate (disabled: needs CLIMATE_API_URL + CLIMATE_API_KEY)`) so operators know what to set.

Alternative: force on/off via the `features` slot in `createOracleApp`:

```ts
features: {
  climate: true,              // force on regardless of autoDetect
  weather: false,             // force off
  composio: 'auto',           // (default) — run autoDetect
}
```

## `.env` files

- `.env` — local secrets, **never commit**.
- `.env.example` — template with every variable (placeholder values). Commit this.
- The starter ships both pre-populated for the bundled set.

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/environment-variables
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-config-and-env
