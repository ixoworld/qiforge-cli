---
name: qiforge-oracle
description: |
  Build, extend, and maintain this QiForge oracle on Cloudflare Workers
  (@ixo/oracle-runtime-workers). Trigger when the user asks to add a plugin,
  add a tool to an existing plugin, wire up an env var or secret, change the
  oracle's identity/prompt, look up a bundled plugin, write or run tests,
  run it locally with wrangler, deploy it, or debug a boot or memory problem.
---

# qiforge-oracle skill

This skill brings the QiForge Workers runtime into context for THIS oracle project. Use it whenever the user asks to extend or modify the oracle, its plugins, its configuration, its tests or its deployment.

## TL;DR — the mental model

The oracle is a **Cloudflare Worker** that calls `createOracleWorker({ config, plugins })` from `@ixo/oracle-runtime-workers` and exports two Durable Object classes. The runtime brings the HTTP/SSE shell (every request authenticated with a UCAN invocation), one Durable Object per user (`UserOracleDO`: the user's SQLite working copy and the agent turn) and the Matrix bot (`MatrixGatewayDO`). You ship the oracle's identity, prompt slots and plugins.

```ts
// src/index.ts
import { BUNDLED_WORKERS_PLUGINS, createOracleWorker } from '@ixo/oracle-runtime-workers';
import { config } from './config';
import { ClimatePlugin } from './plugins/climate/climate.plugin';

const oracle = createOracleWorker({
  config,
  plugins: [...BUNDLED_WORKERS_PLUGINS, new ClimatePlugin()],
});

export const { UserOracleDO, MatrixGatewayDO } = oracle;
export default { fetch: oracle.fetch, scheduled: oracle.scheduled };
```

Two Worker scripts: `wrangler.jsonc` (this oracle script: shell + user objects) and `wrangler.gateway.jsonc` (`src/gateway.ts`: only the Matrix gateway object), bound to each other with `script_name`. They never share an isolate's 128 MB heap.

## How to use this skill

Load only the reference you need:

| Task | Read |
| --- | --- |
| Adding a brand-new plugin | `references/add-a-plugin.md` |
| Adding a tool / sub-agent / middleware / HTTP route to a plugin | `references/add-a-tool.md` |
| The `OraclePlugin` class, its hooks, the manifest, the two contexts | `references/plugin-anatomy.md` |
| Env vars, wrangler `vars`, secrets (`.dev.vars`, `wrangler secret`) | `references/env-vars.md` |
| What the bundled plugins do and what turns each one on | `references/bundled-plugins.md` |
| Writing and running tests (workerd vitest pool) | `references/testing.md` |
| The oracle's identity and prompt slots (`src/config.ts`) | `references/oracle-config.md` |
| How the runtime composes the system prompt | `references/prompt-anatomy.md` |
| Local dev, deploy, the wrangler configs, memory limits | `references/deploy.md` |

## Hard rules — don't break these

- **Workers, not Node.** No `fs`, no `process.env`, no long-lived servers or timers. Configuration arrives as the Worker `env`; plugins read it through their `configSchema` → `ctx.config`.
- **Keep `"minify": true`** in both wrangler configs, and never set `keep_names: false`. A user object that crosses the 128 MB isolate limit is reset mid-turn; the minified bundle is the cheapest headroom there is.
- **Keep string literals Latin-1** (no character above U+00FF; escape others as `\u…`). One wider character doubles the memory V8 holds for the whole bundle's source. `references/deploy.md` has the check.
- **Keep the `alias` blocks.** `@matrix-org/matrix-sdk-crypto-wasm` → the bot SDK's shim, and (oracle script) `jsdom` → the runtime's linkedom shim. Without them the bundle does not load on workerd.
- **Keep `@ixo/matrix-bot-workers-sdk` at the exact version `@ixo/oracle-runtime-workers` pins**, and the `yjs` override in `pnpm-workspace.yaml`. Upgrade the runtime and the bot SDK together.
- **Per-user state goes in `ctx.kv`**, never on the plugin instance: one instance serves every user in the isolate.
- **kebab-case plugin names**, not colliding with a bundled plugin (`qiforge-cli plugin new` checks).
- **No upstream tool description overrides.** Pass MCP tools through verbatim; put guidance in the manifest.
- **No `as any` / `as unknown as X`** to silence the type checker. Find the real mismatch.
- **Run the tests after writing them.** A test is done when it ran green.

## Quickstart commands

```bash
qiforge-cli plugin new <name>   # scaffold src/plugins/<name>/
pnpm dev                        # wrangler dev, both scripts — http://localhost:8787/health
pnpm typecheck
pnpm test                       # vitest inside workerd
pnpm run build                  # wrangler deploy --dry-run for both scripts
pnpm run deploy                 # gateway script, then oracle script
```

## Source of truth

- The runtime source in `node_modules/@ixo/oracle-runtime-workers/src` (it ships as TypeScript): `index.ts` (`createOracleWorker` options), `plugin-api/` (the plugin contract), `plugins/` (bundled plugins), `core/env.ts` (the env schema).
- The runtime's docs: https://github.com/ixoworld/qiforge/tree/main/packages/oracle-runtime-workers/docs (`configuration.md`, `architecture.md`, `operations.md`).
- The reference Worker: https://github.com/ixoworld/qiforge/tree/main/apps/qiforge-workers-example
- Public docs: https://docs.ixo.world/build-an-oracle

When this skill and the runtime source disagree, the source wins. Update this skill when you notice drift.
