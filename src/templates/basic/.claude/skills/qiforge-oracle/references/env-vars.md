# Environment: vars, secrets, bindings

On Workers the environment is the Worker `env` object. Three sources feed it:

| Kind | Where it lives locally | Where it lives deployed |
| --- | --- | --- |
| Non-secret vars | `vars` in `wrangler.jsonc` / `wrangler.gateway.jsonc` | the same (deployed with the script) |
| Secrets | `.dev.vars` (gitignored; `.dev.vars.example` documents it) | `pnpm exec wrangler secret put <NAME>` or `wrangler secret bulk .dev.vars` |
| Bindings (Durable Objects, R2, rate limits, services) | wrangler config | the same |

The runtime validates the merged env at boot against its core schema (`node_modules/@ixo/oracle-runtime-workers/src/core/env.ts`) plus every loaded plugin's `configSchema`; a missing required key fails the boot with the key's name. `docs/configuration.md` in the runtime repo documents every variable.

## Required (oracle script)

| Name | Kind | Meaning |
| --- | --- | --- |
| `ORACLE_NAME` | var | display name |
| `ORACLE_DID` | var | the oracle's account DID — UCAN audience of every request |
| `BLOCKSYNC_GRAPHQL_URL` | var | did:ixo key resolution |
| `MATRIX_BASE_URL`, `MATRIX_ORACLE_ADMIN_USER_ID` | var | the bot's homeserver and user id |
| `MATRIX_ORACLE_ADMIN_PASSWORD` | secret | the gateway logs its own devices in with it (no access token) |
| `OPEN_ROUTER_API_KEY` | secret | platform LLM key |

## Needed for the full feature set

| Name | Kind | Meaning |
| --- | --- | --- |
| `ORACLE_ENTITY_DID` | var | the oracle's entity; required when the memory plugin loads |
| `NETWORK` | var | `devnet` / `testnet` / `mainnet` (default `mainnet`); picks service defaults |
| `MATRIX_ACCOUNT_ROOM_ID` | var | the oracle's account room: P-256 secrets key and the UCAN signing mnemonic |
| `MATRIX_VALUE_PIN` | secret | decrypts what the account room holds |
| `MATRIX_RECOVERY_PHRASE` | secret | restores room keys from the key backup on a fresh device |
| `MATRIX_HOMESERVER_NAME` | var | server name for room aliases |
| `ORACLE_SIGNING_MNEMONIC` | secret, optional | overrides the signing mnemonic read from the account room |

Without a UCAN signing key (no `ORACLE_SIGNING_MNEMONIC` and nothing readable in the account room) the oracle cannot call IXO services: no owner copy in the VFS, no memory engine, no sandbox. `qiforge-cli new` provisions it; `qiforge-cli setup-signing-key` adds it to older oracles.

## Plugin keys (vars unless noted)

`MEMORY_MCP_URL`, `MEMORY_ENGINE_URL` (memory) · `SANDBOX_MCP_URL` (sandbox) · `FIRECRAWL_MCP_URL` (firecrawl) · `DOMAIN_INDEXER_URL` (domain-indexer) · `VFS_BASE_URL`, `UCAN_STORE_URL` (vfs; explicit values also turn on the user's file tools) · `SKILLS_CAPSULES_BASE_URL` (skills, sandbox) · `COMPOSIO_API_KEY` (secret) and `COMPOSIO_BASE_URL` (composio) · `IXO_CHAIN_TOOLS`, `CHAIN_REST_URL`, `IXO_NAMES_URL` (ixo-chain).

## Common optional keys

`LOG_LEVEL` · `ORACLE_DEBUG_ROUTES` (keep `false` deployed) · `DEFAULT_MODEL` · `DECISION_PROVIDER` / `CAPABILITY_ROUTER` · `MATRIX_CHAT_DELIVERY` · `ORACLE_PUBLIC_URL` (with `ARTIFACT_BUCKET`) · `LANGSMITH_*` (secrets for the key) · `SLACK_ALERT_WEBHOOK_URL` (secret).

## Adding your own

1. Declare it in the plugin's `configSchema` (never read `env` directly in tool code).
2. Non-secret → `vars` in `wrangler.jsonc`. Secret → `.dev.vars` and `wrangler secret put`.
3. Document it in `.dev.vars.example` if it is a secret.
4. Regenerate the env types if you use them: `pnpm cf-typegen`.

## Which script needs what

The gateway script (`wrangler.gateway.jsonc`) needs only the identity and Matrix vars plus three secrets: `MATRIX_ORACLE_ADMIN_PASSWORD`, `MATRIX_RECOVERY_PHRASE`, `MATRIX_VALUE_PIN`. Everything else belongs to the oracle script. Locally, `pnpm dev` runs both and both read `.dev.vars`.
