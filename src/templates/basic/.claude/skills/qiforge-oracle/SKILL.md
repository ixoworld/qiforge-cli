---
name: qiforge-oracle
description: |
  Build, extend, and maintain this QiForge oracle. Trigger when the user asks
  to add a plugin, add a tool to an existing plugin, wire up an env var, change
  the oracle's identity/prompt, look up a bundled plugin's interface, write
  tests with createTestRuntime, or debug runtime boot issues.
---

# qiforge-oracle skill

This skill brings the QiForge framework into context for THIS oracle project. Use it whenever the user asks to extend or modify the oracle, its plugins, its env, or its tests.

## TL;DR — the mental model

A QiForge oracle is **one `src/main.ts`** that calls `createOracleApp({ config, plugins, … })` plus **one folder per plugin** under `src/plugins/<name>/`. The runtime handles HTTP, auth, the agent graph, the checkpointer, Matrix sync, and bundles 14 plugins by default. You ship glue code, not infrastructure.

```ts
import { createOracleApp } from '@ixo/oracle-runtime';
import { MyPlugin } from './plugins/my-plugin/my-plugin.plugin.js';
import { config } from './config.js';

const app = await createOracleApp({
  config,
  plugins: [new MyPlugin()],
});

await app.listen();
```

## How to use this skill

The references below carry the dense, scenario-specific guidance. Load only what you need:

| Task | Read |
| --- | --- |
| Adding a brand-new plugin to this oracle | `references/add-a-plugin.md` |
| Adding a tool / sub-agent / middleware to an existing plugin | `references/add-a-tool.md` |
| Understanding the OraclePlugin class — all 9 hooks, manifest, visibility | `references/plugin-anatomy.md` |
| Wiring env vars (plugin-specific or runtime) | `references/env-vars.md` |
| What the 14 bundled plugins do, when each loads, their env requirements | `references/bundled-plugins.md` |
| Writing tests via `createTestRuntime` | `references/testing.md` |

## Hard rules — don't break these

- **kebab-case plugin names.** Match the folder, `name` field, and the published `@ixo/oracle-runtime` reserved set. The CLI rejects collisions; you should too.
- **No upstream tool description overrides.** When wrapping an MCP tool, pass `name`/`description`/`schema` through verbatim. Put your guidance in the manifest (`whenToUse` / `whenNotToUse` / `examples`), never as a client-side description override.
- **No `as any` / `as unknown as X` to silence the type checker.** Find the actual mismatch. The runtime types are exhaustive.
- **No raw `process.env` reads inside plugins.** Declare a `configSchema` on the plugin — the runtime composes and validates it at boot, then exposes the parsed values via `ctx.config`.
- **No `skipMatrixInit` / `skipGracefulShutdown` outside unit tests.** Integration tests must boot real services.
- **Run tests after writing them.** Don't claim a test as done until it executes green.

## Quickstart commands

```bash
# Scaffold a new plugin into src/plugins/<name>/
qiforge-cli plugin new <name>

# Type-check
pnpm typecheck

# Tests
pnpm test                          # all
pnpm test src/plugins/<name>       # just one plugin

# Dev server (hot reload)
pnpm dev
```

## Source of truth

This skill condenses content from the public docs:

- **Single-page AI-agent reference:** https://docs.ixo.world/build-an-oracle/for-ai-agents
- **Build track (recipes):** https://docs.ixo.world/build-an-oracle/build/overview
- **Reference docs (every signature):** https://docs.ixo.world/build-an-oracle/reference/createoracleapp

When this skill and the live docs disagree, the live docs win. Update this skill when you notice drift.
