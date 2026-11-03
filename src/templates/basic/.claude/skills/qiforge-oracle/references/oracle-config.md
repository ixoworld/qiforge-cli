# Oracle config

`src/config.ts` holds the oracle's identity and prompt slots; `src/index.ts` passes it to `createOracleWorker({ config })`.

## The OracleConfig shape

```ts
interface OracleConfig {
  name: string;            // display name
  org?: string;            // operator organisation
  description?: string;   // one sentence: what the oracle does
  prompt?: {
    opening?: string;             // replaces the generated identity sentence, verbatim
    capabilities?: string;        // elevator pitch above the plugin capability block
    communicationStyle?: string;  // appended to "## Operating principles"
    customInstructions?: string;  // "## Custom Instructions": house style, domain rules, guardrails
  };
  delivery?: DeliveryConfig;      // chat-delivery tuning (Matrix chat style, per-surface limits)
}
```

Without `opening` the runtime writes `You are <name>, an AI agent operated by <org>. <description>.` (or a shorter form when `org` / `description` are missing). A user's `agentName` preference overrides `name` in the prompt.

## Not in config.ts

- **`entityDid`** — read from the `ORACLE_ENTITY_DID` var in `wrangler.jsonc` (`qiforge-cli new` fills it in). The memory plugin refuses to boot without a well-formed one.
- **`ORACLE_NAME`** — the var in both wrangler configs (device names, replies). Keep it in step with `config.name`.
- Anything the runtime composes itself: date, memory, preferences, tool discovery rules (see `prompt-anatomy.md`).

## Other `createOracleWorker` options

Set in `src/index.ts` next to `config` (`CreateOracleWorkerOptions` in the runtime's `src/index.ts`):

| Option | Use |
| --- | --- |
| `plugins` | every plugin the oracle may load |
| `features` | per-plugin toggle: `false` leaves it out, `true` requires it (boot fails if its auto-detect fails), `'auto'` / absent loads it when its auto-detect passes |
| `manifestOverrides` | retune a loaded plugin's manifest, e.g. `{ portal: { visibility: 'always' } }` |
| `routes`, `authExcludedRoutes` | extra host HTTP routes, and which of them skip UCAN auth |
| `hooks` | `getRoomTitle`, `safetyModel` per turn |
| `domainContext` | observe-only domain context (anchored `domain.md` in the prompt) |
| `decisionAdapter`, `decisionProviders`, `decisionProviderPolicy` | bounded Decisions providers |
| `listModels` | replace the `GET /models` listing |
