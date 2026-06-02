# Oracle config

`src/config.ts` is the single place you define your oracle's identity and system-prompt fragments. Everything else in the prompt is assembled by the runtime automatically.

## The OracleConfig shape

```ts
interface OracleConfig {
  name: string;           // Display name — "Aria", "DevBot", "IXO Assistant"
  org?: string;           // Operator org name — "Acme Corp", "IXO World"
  description?: string;  // One sentence: what this oracle does
  prompt?: {
    opening?: string;          // Verbatim identity preamble
    communicationStyle?: string; // Injected into ## Operating principles
    capabilities?: string;     // Injected above the Tier-1 plugin capability block
  };
}
```

None of the fields except `name` are required — the runtime falls back gracefully for everything else.

## The `prompt` fields in detail

### `prompt.opening`

Used **verbatim** as the ORACLE_SECTION at the top of the assembled prompt. This is the first thing in every system prompt, so it sets the agent's entire personality and framing.

When absent, the runtime generates a fallback identity line:
- Full fallback: `"You are {name}, an AI agent operated by {org}. {description}."`
- Without `org`: `"You are {name}. {description}."`
- Without both: `"You are {name}."`

**Use `opening` when** the generated fallback is too generic or you need markdown, role framing, tone, or multi-sentence identity prose.

### `prompt.communicationStyle`

Injected inside the hardcoded `## Operating principles` section (the 7-bullet block that is always present). Rendered only when non-empty. Use it for style and behavioral constraints that belong alongside the built-in principles — preferred vocabulary, response length norms, cultural considerations, or persona quirks.

### `prompt.capabilities`

Injected **above** the Tier-1 plugin capability block. The runtime adds no header — the text appears as-is. Use it to orient the agent about what it can do at a high level before the plugin manifests enumerate the specifics. Omit this field (don't pass an empty string) to skip the section entirely.

## What the runtime handles automatically — do NOT duplicate in config

The following are injected without any action from you. Writing them into `config.ts` is redundant at best and contradictory at worst:

- **Current time / timezone** — always present from the user's client headers
- **Memory (6 slots)** — `identity`, `work`, `goals`, `interests`, `relationships`, `recent` — pre-fetched per session before the agent starts
- **User preferences** — `agentName`, `language`, `tone`, `formality`, `customInstructions` — loaded from DB per room; a user-set `agentName` silently overrides `config.name`
- **Tier-1 capability block** — plugin manifests with `visibility='always'`, 5000-token soft budget
- **Operating principles** — 7 hardcoded bullets, always present
- **Operational mode block** — always present
- **Composio context** — injected when the Composio plugin loads
- **Slack formatting constraints** — injected when `session.client === 'slack'`

## `entityDid` — where it lives

The oracle's on-chain entity DID comes from the `ORACLE_ENTITY_DID` environment variable. It is **never** placed in `config.ts`. Declare it in `.env` (and `.env.example`). The runtime reads it directly.

## Worked example — a complete config.ts

```ts
// src/config.ts
import type { OracleConfig } from '@ixo/oracle-runtime';

export const config: OracleConfig = {
  name: 'Aria',
  org: 'IXO World',
  description: 'A personal oracle that helps IXO contributors stay aligned with project goals, surface relevant context, and act across the IXO ecosystem.',

  prompt: {
    opening: `You are Aria, a personal oracle operated by IXO World on behalf of the authenticated user.

You help IXO contributors — developers, impact investors, and project owners — stay oriented within the IXO ecosystem. You surface relevant entities and claims, draft proposals and reports, and act on behalf of the user across IXO protocols when they grant the necessary capabilities.

You do not speculate about on-chain state — you query it. You do not invent DID identifiers — you resolve them. When you are uncertain, you say so and offer to look it up.`,

    communicationStyle: `Prefer concise responses — lead with the answer, follow with context if needed. Use markdown for structure only when the output genuinely benefits from it (lists of 3+ items, code, tables). Mirror the user's register: technical users get technical answers; plain-language users get plain-language answers.`,

    capabilities: `You have access to IXO domain tools (entity lookup, claims, bonds), web research via Firecrawl, long-term memory per user, and — when the user has connected external accounts — over 250 SaaS integrations through Composio.`,
  },
};
```

### Why this config is strong

- `opening` is multi-paragraph and sets a clear behavioral contract ("you do not speculate… you do not invent"). It replaces the generic fallback entirely.
- `communicationStyle` is concrete and actionable rather than vague ("be helpful, be concise").
- `capabilities` gives the agent a mental map before the plugin manifests enumerate the details — useful when there are many `on-demand` plugins that won't appear in the Tier-1 block until loaded.
- `org` and `description` are still present so tooling that reads them (CLI, Portal UI) has clean values.

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/oracle-config
- https://docs.ixo.world/build-an-oracle/build/configure-identity
