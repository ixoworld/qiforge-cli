# Prompt anatomy

The runtime assembles the system prompt from up to 15 sections on every turn. As the developer, **you write 3 things** (`opening`, `communicationStyle`, `capabilities` in `config.ts`). The runtime handles the other 12.

## The 15 sections in order

| # | Section | Always present? | Source |
| --- | --- | --- | --- |
| 1 | ORACLE_SECTION | always | `config.prompt.opening` verbatim, or runtime-generated fallback |
| 2 | \[CAPABILITIES_NOTE\] | if non-empty | `config.prompt.capabilities` |
| 3 | \[CAPABILITY_BLOCK\] | if any plugin has `visibility='always'` | Runtime: Tier-1 plugin manifests, 5000-token soft budget |
| 4 | `## Operating principles` | always | Hardcoded 7-bullet block + `config.prompt.communicationStyle` appended |
| 5 | `## Working with files` | always | Hardcoded |
| 6 | `## What you know about the user` | if any memory slot is populated | Runtime: 6 memory slots pre-fetched by `UserContextFetcher` |
| 7 | `**Current time:**` | always | Runtime: from user's UCAN / client headers |
| 8 | `**Current entity:**` | if set | Runtime: oracle entity context |
| 9 | `## Available user secrets` | if user has secrets | Runtime: secret index from the secrets store |
| 10 | `## User preferences` | if any preference is set | Runtime: `agentName`, `language`, `tone`, `formality`, `customInstructions` from DB |
| 11 | `## Operational mode` | always | Hardcoded |
| 12 | \[COMPOSIO_CONTEXT\] | if Composio plugin loaded | Runtime: Composio plugin injection |
| 13 | \[EDITOR_SECTION\] | if editor session active | Runtime: collaborative editor context |
| 14 | \[SLACK_FORMATTING_CONSTRAINTS\] | if `session.client === 'slack'` | Runtime: Slack-specific formatting rules |
| 15 | \[Degraded services\] | if any service degraded | Runtime: post-template append |

## What you write vs what the runtime handles

**You write (in `config.ts`):**
- `prompt.opening` — the full identity preamble (section 1)
- `prompt.capabilities` — orientation text before the plugin list (section 2)
- `prompt.communicationStyle` — appended to the Operating principles block (section 4)

**Runtime handles automatically:**
- All plugin manifests (section 3) — assembled from plugin `manifest` fields
- Memory (section 6) — pre-fetched before the agent starts; already present on turn 1
- Time/timezone (section 7) — from the user's client headers
- User preferences (section 10) — loaded from DB per room before agent starts
- All other conditional sections — injected based on session state, never configured manually

## The Tier-1 capability block (section 3)

The runtime collects manifests from every plugin with `visibility='always'` and renders them into a single capability block. There is a **5000-token soft budget** — if the combined manifests exceed it, lower-priority plugins are trimmed. This block is what allows the agent to know about `always`-visibility capabilities without the user asking. `on-demand` plugins do not appear here until the agent or user calls `load_capability`.

## The key insight

You cannot control sections 3–15 through `config.ts`. If you need to influence behavior in those sections, the right levers are:

- **Plugin manifest** (`whenToUse`, `whenNotToUse`, `examples`) — controls how section 3 reads
- **User preferences** (via `set_user_preferences` tool) — controls section 10
- **Plugin visibility** (`always` / `on-demand` / `silent`) — controls whether section 3 includes the plugin at all
- **`communicationStyle`** — the only config field that affects a hardcoded section (section 4)

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/prompt-composer
- https://docs.ixo.world/build-an-oracle/understand/system-prompt
