# `qiforge new` flow cleanup + Composio key fix

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Problem

Three defects, discovered together:

1. **The Agent Card is never saved locally.** `qiforge new` builds a card, uploads
   it to Matrix, and anchors it on-chain — but `saveAgentCardLocally()` is only
   ever called from `agent-card.command.ts:426`. A project scaffolded by `new`
   has no `agent-card.json` and no `AGENT_CARD_PATH` in `.env`.

2. **The `new` prompt flow is bloated and partly dead.** It asks ~15 questions
   plus a confirm before every Agent Card service. Several answers are collected
   and then silently discarded: `create-entity-command.ts` gathers `model`,
   `promptOpening`, `promptStyle`, `promptCapabilities`, and `mcpServers` but
   passes none of them to `CreateEntity.execute()`. It also never asks for an
   avatar image, defaulting every oracle to a generated dicebear URL.

3. **Composio API key creation fails on every project after the first.**
   Diagnosed below.

## Composio diagnosis

`create-project-env-file.ts:218` calls:

```ts
fetchOrCreateEdMnemonic({ ..., pin: regResult.pin })
```

`regResult.pin` is the PIN collected at `entity.ts:670` ("Enter a 6-digit PIN to
secure your Matrix Vault"). That is a **per-oracle** secret — it encrypts the
newly-provisioned oracle's Matrix mnemonic.

It is then reused as the key that decrypts the ED signing mnemonic stored in the
**user's own** Matrix room (`wallet.matrix.roomId`), which was encrypted with
whatever PIN was typed the *first* time the user ever ran the CLI. Two different
scopes sharing one variable.

Consequence:

- First project ever: no blob in the room → 404 → a fresh mnemonic is created and
  encrypted with PIN₁. Works.
- Every later project: user types PIN₂ → `decrypt()` (`composio.ts:57`) runs
  AES-256-CBC with the wrong key → padding check throws → `Failed to decrypt ED
  signing mnemonic — wrong PIN?` → swallowed by the catch at
  `create-project-env-file.ts:232` → `⚠️ Could not create Composio API key`.

No HTTP request to Composio is ever made.

### What was ruled out

A staged live diagnostic against the real worker confirmed everything downstream
is healthy, given the correct PIN:

| Stage | Result |
|---|---|
| Read + decrypt ED mnemonic from Matrix room | ✓ with the original PIN |
| Ed25519 VM indexed on-chain (devnet) | ✓ `Ed25519VerificationKey2018` / `8RpaQwfNKxiyDiqhXnwFmheK2DnypZutJmtJ9WvaypZ5` |
| `POST /v1/keys` | ✓ `201 Created` (twice) |

The subscription gate (`composio-worker/src/lib/subscription.ts:176`) passes for
subscribed users. An earlier `402 No subscription found` reproduced with a
throwaway `did:key` was a property of that unsubscribed test key, not of the
CLI's flow.

### Unrelated worker bug found while reading

`composio-worker/wrangler.jsonc:68-75` contains a stray `"name"` /`"json"` pair
inside the `vars` object — `[[vars]]` TOML binding syntax pasted into a JSON
file. It defines two junk vars and means the fifth DID listed there,
`did:ixo:ixo1dy522mm3d8kzeyd72chs0m9zpdls5prg5fc64z`, is **not** actually in
`SUBSCRIPTION_BYPASS_DIDS` despite appearing to be. Out of scope for this spec;
tracked separately.

## Design

### 1. `qiforge new` question set

**Stage 1 — Project** (`new.command.ts`)

| # | Question | Default |
|---|---|---|
| 1 | Oracle name | — |
| 2 | One-line description | `An oracle built with QiForge.` |
| 3 | Organization name | `IXO` |
| 4 | Avatar image URL | dicebear, seeded from name |
| 5 | Network | `devnet` |
| 6 | Relayer node | IXO default for network |
| 7 | Install dependencies with pnpm? | yes |

Then the existing 6-digit vault PIN prompt inside `CreateEntity`.

Network moves ahead of scaffolding. Today `new.command.ts:256` renders the
template with a hardcoded `network: 'devnet'` while the real network is only
chosen later inside `create-entity` — so choosing testnet still scaffolds devnet
files. With the prompt moved up, `create-entity` sees `config.network` already
set and skips its own `selectNetwork()`.

The avatar URL is stored as `prefillLogo` in `RuntimeConfig` and used for both
`profile.logo` and `profile.coverImage`. Validation reuses `checkRequiredURL`.

**Stage 2 — Agent Card** — now mandatory, minimum one service.

| # | Question |
|---|---|
| 1 | Service name |
| 2 | Service description |
| 3 | Price in USDC |
| 4 | Deliverables (one sentence) |
| 5 | `"Done" means` → `"Done" also means (2, blank to finish)` → … (max 10) |
| 6 | Next service name, blank to finish (max 20) |

Service `id` is derived from the name, not prompted: lowercase, non-alphanumeric
runs → `-`, collapse repeats, trim leading/trailing `-`. Must satisfy the
existing `SERVICE_ID_REGEX`. On collision with an already-entered service,
append `-2`, `-3`, … A name that slugs to an empty string falls back to
`service-<n>`.

Both "add another?" confirms are replaced by blank-to-finish inputs. The first
`doneMeans` sentence and the first service name stay required; subsequent ones
accept an empty string as the terminator.

**Removed entirely:**

- Plugin multiselect, `--plugins` flag, `src/utils/plugin-catalog.ts`,
  `RuntimeConfig.selectedPlugins`, the post-scaffold plugin env-var hint block
- `buildAgentCardSeeds()`, `AgentCardServiceSeed`, and every seed confirm
- The `Add an Agent Card now?` confirm
- The service-id prompt and both "add another?" confirms
- LLM model select, opening prompt, communication style, capabilities description
  (all currently discarded)
- Price in IXO credits, the `--price` flag, `createFeesConfig()`, and the
  `pricingList` (`{id}#fee`) linked resource. `oracleConfig.price` is dropped
  from `CreateEntityParams`; `createOracleConfigFiles` is left with only
  `createAuthZConfig`. Nothing reads the fee resource back — the Agent Card's
  per-service USDC price is the pricing mechanism.
- Dead `authZFile` / `feesFile` keys on `RuntimeConfig.Config` (declared, never
  read or written)

Net: 15 prompts + 2N confirms → 7 prompts + 4 per service.

### 2. Agent Card local copy

`CreateEntity` stashes the assembled card via
`config.addValue('agentCard', card)` after `buildAgentCard()` in
`createAgentCard()`. `new.command.ts` then calls `saveAgentCardLocally(projectPath, card)`
**after** `createProjectEnvFile()`.

Ordering is load-bearing: `createProjectEnvFile()` writes `.env` wholesale
(`create-project-env-file.ts:258`), so an `upsertEnvVar` performed earlier during
entity creation would be erased.

`saveAgentCardLocally()` already writes `agent-card.json` and upserts
`AGENT_CARD_PATH`; no change needed there. Failure to save stays non-fatal — the
card is already published on-chain at that point.

### 3. Composio PIN fix

Add `edKeyPin?: string` to `WalletProps` (`src/utils/signx/types.ts`), persisted
in `~/.wallet.json`. This is consistent with the existing trust model: that file
already stores the wallet mnemonic and, for offline wallets, the Matrix password.

Resolution order in `create-project-env-file.ts`:

1. `wallet.edKeyPin` present → use it.
2. Absent, and no blob in the room (404) → use the current oracle PIN, create the
   mnemonic as today, and persist that PIN as `edKeyPin`.
3. Absent, and a blob exists (legacy users) → prompt *"PIN that unlocks your
   Composio signing key (from your first project)"*, retry up to 3 times, persist
   on success.

`fetchOrCreateEdMnemonic` keeps its current signature; the caller resolves which
PIN to pass. The per-oracle vault PIN is never again used against the user's room.

### 4. Enrich the domain card with Agent Card services

The Agent Card carries the richest description of what the oracle actually does
(named services, prices, deliverables, acceptance criteria). That information
should also land on the **domain card**, which is the entity's public profile
document, so consumers reading the domain card see the offering without having to
resolve the separate Agent Card resource.

The IXO domain-card schema already reserves `credentialSubject.makesOffer`
(`https://raw.githubusercontent.com/ixoworld/domainCards/main/schemas/ixo-domain-card-1.json`,
`type: ["object","array"]`, `additionalProperties: true`). Map each Agent Card
service to a `schema:Offer`:

```jsonc
{
  "type": "schema:Offer",
  "identifier": "<service.id>",
  "itemOffered": {
    "type": "schema:Service",
    "name": "<service.name>",
    "description": "<service.description>",
    "serviceOutput": "<service.deliverables>"
  },
  "priceSpecification": {
    "type": "schema:PriceSpecification",
    "price": <service.price.amount>,
    "priceCurrency": "USDC"
  },
  "ixo:acceptanceCriteria": ["<...service.doneMeans>"]
}
```

`CreateEntity.createDomainCard()` gains an optional `services` parameter. When
present and non-empty, `credentialSubject.makesOffer` is set to the mapped array;
when absent, the field is omitted entirely (existing behaviour unchanged).
`params.agentCard?.services` is already in scope at the `createDomainCard()` call
site (`entity.ts:748`), so this is a wiring change, not a new data source. The
mapping is a pure function (`servicesToOffers`) exported from `agent-card.ts` for
unit testing.

### 5. Composio error surfacing

Stays non-fatal — a project without a Composio key is still usable — but the
catch at `create-project-env-file.ts:232` distinguishes causes and prints a
recovery path instead of one vague line:

```
⚠  Composio API key not created
   reason: <decrypt failed | subscription required | worker HTTP 5xx | …>
   fix:    qiforge-cli create-composio-key
   (everything else in your project is set up)
```

`create-composio-key` already exists as a registered command.

## Section numbering note

Sections were renumbered when domain-card enrichment (§4) was inserted; Composio
error surfacing is §5.

## Testing

- **Unit** — slug derivation (collisions, empty-slug fallback, regex conformance);
  blank-to-finish loops (first entry required, blank terminates, max caps
  enforced at 10 / 20); `edKeyPin` resolution across the three branches above.
- **Existing** — `src/__tests__/env-file.test.ts` covers `upsertEnvVar`; extend
  to assert `AGENT_CARD_PATH` survives a `createProjectEnvFile()` rewrite when
  written afterwards.
- **Manual** — run `qiforge new` twice in a row with *different* vault PINs and
  confirm a Composio key is minted both times; confirm `agent-card.json` exists
  and `AGENT_CARD_PATH` is set in both projects; confirm choosing testnet
  scaffolds testnet values.

## Out of scope

- The `wrangler.jsonc` vars bug in `composio-worker`
- `CLAUDE.md` references `src/utils/oracle-config.ts` / `saveOracleConfig()`,
  which do not exist; correcting the doc is a separate cleanup
- The blocksync indexing race between `MsgAddVerification` and delegation
  minting (`composio.ts:156-170`) — real but not observed to fire here
