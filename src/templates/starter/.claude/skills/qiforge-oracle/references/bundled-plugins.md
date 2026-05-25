# Bundled plugins

The runtime ships 14 plugins out of the box. They all resolve at boot — toggling is via `features` in `createOracleApp`, and most are gated by `autoDetect` on their env vars.

## The catalog

| Name | Visibility | Default behavior | Required env | What it does |
| --- | --- | --- | --- | --- |
| `memory` | always | on | `MEMORY_MCP_URL`, `MEMORY_ENGINE_URL` | Per-user encrypted memory via the Memory Engine. |
| `portal` | on-demand | on | — | IXO entity / portal lookups. |
| `firecrawl` | on-demand | auto-detect | `FIRECRAWL_MCP_URL` | Web crawl / scrape via Firecrawl MCP. |
| `domain-indexer` | always | on | — | Browse IXO domain entities. |
| `composio` | on-demand | auto-detect | `COMPOSIO_API_KEY` | 250+ SaaS integrations (Gmail, Slack, Notion, etc.). |
| `sandbox` | always | auto-detect | `SANDBOX_MCP_URL` | Sandboxed code/file execution. |
| `skills` | always | on (needs `sandbox`) | — | Discover and run capsule skills. |
| `editor` | on-demand | on (needs Matrix) | — | Collaborative document editor (Matrix-backed). |
| `agui` | on-demand | on | — | Agentic UI primitives. |
| `slack` | silent | auto-detect | `SLACK_BOT_OAUTH_TOKEN` | Slack bot integration. |
| `tasks` | stub | auto-detect | `REDIS_URL` | Background queues (BullMQ) — currently stub. |
| `credits` | silent | on unless `DISABLE_CREDITS=true` | — | Per-user credit accounting. |
| `calls` | stub | on | — | Voice/calls — currently stub. |
| `user-preferences` | always | on | — | Per-user preference store. |

## Toggling

```ts
await createOracleApp({
  config,
  features: {
    composio: false,         // hard off — never load
    firecrawl: 'auto',       // default — run autoDetect
    memory: true,            // hard on — load even without env (fail at boot if missing)
  },
});
```

| Value | Behavior |
| --- | --- |
| `true` | Force on — bypass autoDetect. Missing required env throws at boot. |
| `false` | Force off — never load, never in registries. |
| `'auto'` | Default — run `autoDetect(env)`. |

## Replacing a bundled plugin

The plugin loader dedupes by `name`. To customize a bundled plugin, instantiate it explicitly in `plugins: []` — your instance wins:

```ts
import { EditorPlugin, createOracleApp } from '@ixo/oracle-runtime';

await createOracleApp({
  config,
  plugins: [
    new EditorPlugin({ matrixClient }),    // overrides the bundled default
  ],
});
```

This is the canonical pattern for plugins that need live runtime objects (Matrix client, Redis).

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/bundled-plugins
- https://docs.ixo.world/build-an-oracle/build/enable-bundled-plugins
