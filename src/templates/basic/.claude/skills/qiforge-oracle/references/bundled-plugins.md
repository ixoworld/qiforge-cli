# Bundled plugins

`BUNDLED_WORKERS_PLUGINS` (spread into `plugins` in `src/index.ts`) ships these. Each gates itself: a plugin whose key is absent leaves itself out, and the boot log says why. Source: `node_modules/@ixo/oracle-runtime-workers/src/plugins/` (`index.ts` lists the bundle).

| Plugin | Turned on by | Visibility | What it does |
| --- | --- | --- | --- |
| `memory` | `MEMORY_MCP_URL` (+ `MEMORY_ENGINE_URL`, `ORACLE_ENTITY_DID`) | always | Long-term per-user memory through the IXO memory engine; first-turn memory prefetch |
| `sandbox` | `SANDBOX_MCP_URL` | always | Code execution and files in the IXO AI sandbox |
| `firecrawl` | `FIRECRAWL_MCP_URL` | on-demand | Web search and scraping |
| `domain-indexer` | always on (`DOMAIN_INDEXER_URL`) | on-demand | Entity and domain lookup across the IXO ecosystem |
| `composio` | `COMPOSIO_API_KEY` | on-demand | SaaS integrations through IXO's Composio gateway |
| `vfs` | an oracle UCAN signing key; explicit `VFS_BASE_URL` / `UCAN_STORE_URL` | on-demand | The user's Virtual Filesystem (files across sessions) |
| `tasks` | always on | — | Scheduled and recurring tasks run by the user's Durable Object |
| `editor` | always on | on-demand | Reads and edits the user's collaborative editor documents |
| `user-preferences` | always on | always | Tone, language, formality, what to call the agent |
| `portal` | always on | on-demand | The Portal's browser-side tools |
| `agui` | always on | on-demand | Interactive UI components (tables, charts, forms) in the browser |
| `attachments` | always on | always | Re-reads files the user attached earlier in the conversation |
| `matrix-group-chats` | always on | on-demand | Behaviour and memory in Matrix group rooms (`MATRIX_GROUP_ROOMS` on the gateway) |
| `pod-creator` | always on | on-demand | Designs and prepares an IXO POD creation batch (mainnet only with `POD_CREATOR_ALLOW_MAINNET=true`) |
| `ixo-chain` | on unless `IXO_CHAIN_TOOLS=off` | on-demand | Read-only chain lookups: balances, account overview, entities |
| `action-proposals` | `ACTION_PROPOSALS_ENABLED=true` | on-demand | Action cards the owner reviews and signs in the Portal |
| `hub-actions` | `HUB_ACTIONS_ENABLED=true` + `AUTH_HUB_URL` + `AUTH_HUB_CHANNEL_SERVICE_KEY` | on-demand | Auth Hub action preparation (WhatsApp channels) |

## Exported but opt-in

Construct these yourself and add them to `plugins`:

- `SkillsPlugin` — discover IXO skill capsules (`SKILLS_CAPSULES_BASE_URL`).
- `FlowsPlugin` — the Flow Builder.
- `IxoTransactionPlugin` — asks the user's Portal wallet to sign chain transactions (testnet only unless `IXO_TRANSACTION_ALLOW_MAINNET=true`).
- `WeatherPlugin` — the demo plugin that exercises every hook.

## Toggling

```ts
createOracleWorker({
  config,
  plugins: [...BUNDLED_WORKERS_PLUGINS],
  features: { composio: false, firecrawl: true }, // false = leave out; true = required (boot fails if its auto-detect fails)
  manifestOverrides: { 'user-preferences': { visibility: 'always' } },
});
```

Plugin names are reserved: `qiforge-cli plugin new` refuses a name that collides with one of these.
