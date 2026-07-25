# Bundled plugins

The runtime ships 14 plugins out of the box. They all resolve at boot — toggling is via `features` in `createOracleApp`, and most are gated by `autoDetect` on their env vars.

Four more (`credits`, `slack`, `calls`, `flows`) live in the package but are **not** in `BUNDLED_PLUGINS`, so `features` never reaches them — construct each one and pass it in `plugins`.

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
| `tasks` | on-demand | auto-detect | `REDIS_URL` | Background queues (BullMQ). |
| `user-preferences` | always | on | — | Per-user preference store. Tool: `set_user_preferences`. Fields: `agentName` (overrides `config.name` in the prompt), `language`, `tone`, `formality`, `customInstructions`. |
| `matrix-group-chats` | on-demand | on | — | Bot gating + per-room compacted memory for Matrix group rooms. |
| `vfs` | on-demand (`vfs_search`/`vfs_read` always) | on | — (worker URLs from `NETWORK`) | Read, write, search, and share the user's real files on their Virtual Filesystem. |
| `oracle-payments` | always | on unless `ORACLE_PAYMENTS_DISABLED=true` | — (`EVAL_ENGINE_URL` for the paid lane) | Sell services from Matrix chat. See below. |

### Not bundled — wire in explicitly

| Name | Construct with | What it does |
| --- | --- | --- |
| `credits` | `new CreditsPlugin({ redis, network })` | Per-user credit accounting + LLM token metering + on-chain settlement cron. With it off there is **no** metering at all. |
| `slack` | `new SlackPlugin()` | Slack bot transport (`SLACK_BOT_OAUTH_TOKEN`). |
| `calls` | — | Voice/calls — stub, no tools yet. |
| `flows` | `new FlowsPlugin({ matrixClient })` | Author and inspect multi-step Qi Flow templates. |

## `oracle-payments` — selling services from the chat

Turns the user's Matrix DM room into a commerce surface. The oracle runs two personas in one room: a free **support** persona (what do you sell, what does it cost, am I contracted?) and a paid **work** persona (performs one contracted service). A cheap classifier routes each Matrix message; once a job starts in a thread, routing is sticky for that thread.

Key ideas:

- **Agent Card** — the signed list of services the oracle sells, anchored on its entity as the `#acard` LinkedResource. Each service has an `id`, `name`, `description`, `price` (USDC), `deliverables`, and `doneMeans` (1–10 plain sentences that become the evaluation criteria). Publish with `qiforge-cli agent-card`; it also sets `AGENT_CARD_PATH`, which self-describes the plugin manifest so the model knows its own services without a tool call.
- **Contract** — the user grants an on-chain `SubmitClaimAuthorization` scoped to chosen services, with a quota of jobs and a per-job max amount. Not a subscription.
- **Engagement** — one paid job, keyed to a Matrix thread. **Only one active per user at a time** (the chain permits one active intent per agent + claim collection).
- **Escrow** — the service price is reserved on-chain when work starts, unconditionally. Released on delivery, cancellation, or when the grant's intent duration lapses (defaults to 1 hour).
- **Delivery** — `deliver_work` hands the file to the user *and* submits a work claim. An independent engine judges it against `doneMeans`: approval pays the oracle, rejection returns the escrow. The claim's `request`/`workSummary` are extracted from the thread by a separate model the work agent doesn't control.
- **Cancellation** — `cancel_work` files a release claim, freeing the reservation immediately. Costs one quota slot.

Tools: `list_services`, `show_contract`, `get_contract_status`, `get_thread_attachment` (support mode); `deliver_work`, `cancel_work`, `get_thread_attachment` (work mode).

Prerequisites for the paid lane: an Agent Card published, `EVAL_ENGINE_URL` set, and an evaluation engine that accepts intent-backed agent-work claims. Chat and support work without any of it.

## What the runtime injects automatically

These three things are handled entirely by the runtime. You do not need to write prompts, tools, or config to enable them — they are present on every turn for every user.

**Memory pre-fetch**

`UserContextFetcher` loads all 6 context slots (`identity`, `work`, `goals`, `interests`, `relationships`, `recent`) into the system prompt **before the agent is compiled for the turn**, using a 5-minute session cache. Each slot can contain `entities` (name, labels, summary), `facts` (fact text), `episodes` (content + date), and `communities` (name, summary). Empty slots are silently dropped — the `## What you know about the user` block only appears when at least one slot has content. The practical consequence: **you do not need to instruct the agent to recall memory** — it is already there on turn 1. The `memory` plugin tools are for writing and searching memory, not for reading what is already injected.

**User preferences**

Preferences are hydrated from the database per room before the agent starts. The `user-preferences` plugin (visibility: `always`) exposes the `set_user_preferences` tool so users can configure their preferences mid-conversation. A user-set `agentName` silently overrides `config.name` in the rendered prompt — the agent will introduce itself by the user's chosen name without any extra code.

**Current time**

Always injected as `**Current time:** {currentTime} ({timezone})` derived from the authenticated user's UCAN delegation and client headers. Time-sensitive reasoning requires no special tool call.

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

## Adding global oracle knowledge (memory plugin)

Global knowledge is content the oracle should know on every turn for every user. It is stored on the Memory Engine under the **oracle entity's DID**, not under any individual user.

**Preconditions**

- You must be `owner` or `controller` on the oracle's IXO entity (the entity `qiforge-cli create-entity` registered). The Memory Engine rejects writes from any other DID.

**Plugin configuration** — the default selection does NOT include `memory-engine__add_oracle_knowledge`. Enable it explicitly:

```ts
import {
  createOracleApp,
  MemoryPlugin,
  DEFAULT_MEMORY_TOOLS,
  MEMORY_ADD_ORACLE_KNOWLEDGE_MCP_NAME,
} from '@ixo/oracle-runtime';

await createOracleApp({
  config,
  plugins: [
    new MemoryPlugin({
      selectedTools: [
        ...DEFAULT_MEMORY_TOOLS,
        MEMORY_ADD_ORACLE_KNOWLEDGE_MCP_NAME,
      ],
    }),
  ],
});
```

**Workflow**

1. Boot the oracle (`pnpm dev`).
2. Open the Portal for the matching network and connect:
   - devnet: `https://dev.portal.qi.space/domain/<ORACLE_ENTITY_DID>/connect`
   - testnet: `https://test.portal.qi.space/domain/<ORACLE_ENTITY_DID>/connect`
   - mainnet: `https://portal.qi.space/domain/<ORACLE_ENTITY_DID>/connect`
3. Sign in as the entity owner/controller and click the highlighted "Connect" action — the Portal opens a chat session bound to the oracle.
4. Drag and drop files (PDFs, markdown, text), paste links, or paste raw text. Then say "Save this into the global oracle knowledge."
5. Wait ~5 minutes for indexing. After that, every user's session can recall it through `memory-engine__search_memory_engine`.

**Warning** — `add_oracle_knowledge` writes are visible to every user that talks to this oracle. Treat it like a public knowledge base.

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/bundled-plugins
- https://docs.ixo.world/build-an-oracle/develop/enable-bundled-plugins
