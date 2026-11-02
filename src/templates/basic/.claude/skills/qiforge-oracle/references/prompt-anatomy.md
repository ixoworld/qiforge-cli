# Prompt anatomy

The runtime composes the system prompt on every turn (`composePrompt` in `node_modules/@ixo/oracle-runtime-workers/src/core/prompt-composer.ts`, exported as `@ixo/oracle-runtime-workers/prompt`). **You write four slots** in `config.ts` (`prompt.opening`, `prompt.capabilities`, `prompt.communicationStyle`, `prompt.customInstructions`); the runtime fills the rest.

## Sections, in order

| Section | Present when | Source |
| --- | --- | --- |
| Identity | always | `prompt.opening` verbatim; otherwise generated from `name`, `org`, `description` |
| Capabilities note | `prompt.capabilities` set | your text |
| Capability block | some plugin is `always` visible | the loaded `always` plugins' manifests |
| Browser tools | the Portal declared browser tools this turn | runtime |
| `## Operating principles` | always | runtime principles (discovery: `search_skills`, `list_capabilities`, `load_capability`; asking before acting; reporting results; memory consent; "complete the request and stop") + your `communicationStyle` |
| Surface block | chat delivery (WhatsApp / Matrix chat style) | runtime |
| `## Custom Instructions` | `prompt.customInstructions` set, or a loaded plugin contributes guidance | your text + plugin guides |
| `## What you know about the user` | the memory prefetch returned something | memory engine |
| `**Current date:**` | always | the day and the user's timezone (nothing finer, so the prompt stays cacheable for the day) |
| `**Current entity:**` | an entity is selected | runtime |
| User identity | authenticated user | runtime |
| `## User preferences` | the user set any | user-preferences plugin |
| `## Operational mode` | always | runtime |
| `## Capabilities in use` | plugins with an `operatingGuide` are loaded on the thread | the plugins' operating guides |
| `## Degraded services` | a service is degraded | runtime |

## What that means for you

- Don't restate what the runtime already says (tool discovery, ask-before-acting, memory policy, the date). Duplicates drift and contradict.
- Steer behaviour with the levers that exist: the four slots, plugin manifests (`summary`, `whenToUse`, `whenNotToUse`, `examples`), plugin `visibility`, a plugin's `operatingGuide`, and `manifestOverrides` in `createOracleWorker`.
- `src/config.test.ts` composes the full prompt the way the runtime does; extend it when you add rules the prompt must keep (or must never contain).
