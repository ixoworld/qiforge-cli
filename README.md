# QiForge CLI

Provision QiForge oracles on the IXO network and scaffold their projects on Cloudflare Workers.

`qiforge-cli new` creates the oracle's on-chain identity (entity, DID with its Ed25519 UCAN signing key, Matrix bot account, account room, encryption key, domain card, Agent Card) and scaffolds a Worker on [`@ixo/oracle-runtime-workers`](https://www.npmjs.com/package/@ixo/oracle-runtime-workers) with that identity already wired into its wrangler configs and `.dev.vars`.

## Prerequisites

- Node.js 22+ and pnpm 10+
- To provision: the IXO Mobile App (SignX login) **or** a wallet mnemonic (offline login), with some IXO on the chosen network
- To deploy the oracle: a Cloudflare account on the Workers Paid plan

## Installation

```bash
npm install -g qiforge-cli
# or
pnpm add -g qiforge-cli    # then `pnpm approve-builds -g` and approve protobufjs
```

## Quick start

```bash
qiforge-cli new                 # log in, answer the prompts, provision + scaffold
cd my-oracle
pnpm install                    # unless you let `new` do it
# add OPEN_ROUTER_API_KEY to .dev.vars
pnpm dev                        # wrangler dev → http://localhost:8787/health
```

Scaffold only — no login, nothing on chain or Matrix (the wrangler configs get placeholder identity values):

```bash
qiforge-cli new --no-interactive --name my-oracle --network devnet --skip-entity
```

## What `new` scaffolds

```
my-oracle/
├── src/index.ts              # createOracleWorker({ config, plugins }) + export { UserOracleDO, MatrixGatewayDO }
├── src/gateway.ts            # createGatewayWorker() — the Matrix gateway as its own script
├── src/config.ts             # identity + prompt slots
├── src/config.test.ts        # the composed system prompt carries those slots
├── src/plugins/              # your plugins (qiforge-cli plugin new <name>)
├── test/                     # the Worker the unit tests run in (workerd vitest pool)
├── wrangler.jsonc            # oracle script: vars, Durable Objects, rate limit, crons, aliases, minify
├── wrangler.gateway.jsonc    # gateway script
├── .dev.vars                 # the Worker's secrets (written by `new`; gitignored)
├── .dev.vars.example
├── oracle-credentials.env    # the oracle's wallet mnemonic + Matrix credentials (gitignored; back it up)
├── agent-card.json           # local copy of the published Agent Card
└── .claude/skills/qiforge-oracle/   # Claude Code skill for the Workers runtime
```

- The runtime is pinned exactly to the current npm release, with `@ixo/matrix-bot-workers-sdk` at the exact version that release depends on; `wrangler`, `vitest` and the Workers types follow the runtime's own ranges.
- Two Worker scripts, oracle and gateway, so the Matrix bot never shares an isolate's 128 MB heap with the user objects. Both configs set `"minify": true` (wrangler keeps class and function names when minifying), `nodejs_compat`, the crypto-wasm and jsdom aliases, and `limits.cpu_ms: 300000`.
- `pnpm dev` runs both scripts locally; `pnpm run deploy` deploys the gateway, then the oracle; `pnpm run build` is the `wrangler deploy --dry-run` of both.

## Commands

| Command | What it does |
| --- | --- |
| `new` | Provision an oracle and scaffold its Workers project (`--skip-entity`: scaffold only) |
| `plugin new <name>` | Scaffold a plugin (tool + workerd tests) into the current oracle project |
| `create-entity` | Provision an oracle entity, DID and Matrix account without scaffolding |
| `update-entity` | Add a controller to an entity |
| `update-oracle-api-url` | Point the entity's `#api` / `#ws` services at the deployed Worker URL |
| `agent-card` | Author, validate and publish (or replace) an Agent Card |
| `setup-encryption-key` | Add the P-256 key-agreement key (per-room secrets) to an older oracle |
| `setup-signing-key` | Add the Ed25519 UCAN signing key to an older oracle (see below) |
| `dashboard-access` | Link an oracle to a developer console account |
| `create-user` | Create a user account (wallet, DID, Matrix) |
| `create-composio-key` | Mint a Composio API key for an oracle |
| `offline-login` / `logout` | Log in with a local mnemonic / clear the session |
| `--help`, `--version` | Help and version |

Run `qiforge-cli --help` for every flag.

### Non-interactive `new`

```bash
qiforge-cli new --no-interactive \
  --name my-oracle --network devnet \
  --description "Answers questions about my project" --org "My Org" \
  --pin 123456 --install
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--name` | project and oracle name (required) | — |
| `--path` | target directory | `./<name>` |
| `--network` | `devnet`, `testnet` or `mainnet` | `devnet` |
| `--description`, `--org` | identity | `An oracle built with QiForge.`, `IXO` |
| `--pin` | 6-digit PIN that encrypts the oracle's secrets in its account room | prompted |
| `--install` | run `pnpm install` | off |
| `--force` | overwrite a non-empty directory | off |
| `--skip-entity` | scaffold only: no login, no entity, no Matrix account | off |

In non-interactive mode no Agent Card is published; publish one later with `qiforge-cli agent-card`.

## The oracle's UCAN signing key

The Workers runtime signs every call it makes to IXO services (the user's owner copy in the VFS, the memory engine, the sandbox) with an Ed25519 key, and those services verify it against the oracle's DID document. `new` and `create-entity` generate that key, put its public key on the oracle's DID at creation, and store the mnemonic PIN-encrypted in the oracle's account room (`ixo.room.state.secure` / `encrypted_mnemonic_ed_signing`), where the runtime reads it.

Oracles created by CLI versions before 2.0.0 carry only secp256k1 keys (the Node runtime used to add the Ed25519 key on its first boot; the Workers runtime does not). Give them the key with:

```bash
qiforge-cli setup-signing-key --env oracle-credentials.env   # or a Node-era .env with SECP_MNEMONIC + MATRIX_* + MATRIX_VALUE_PIN
```

It needs no user login: the oracle's own account signs the `MsgAddVerification` (and pays its fee).

## Authentication

- **SignX** (default): QR code with the IXO Mobile App; keep the app open, every transaction is approved on the phone.
- **Offline**: `qiforge-cli offline-login` with a mnemonic; transactions are signed locally.

```bash
qiforge-cli offline-login --network devnet --mnemonic "…" --matrixPassword "…"
```

The session is kept in `~/.wallet.json` (`qiforge-cli logout` clears it).

## Development

```bash
pnpm install
pnpm build        # esbuild → dist/cli.js, templates copied to dist/templates
pnpm test         # jest
pnpm lint
pnpm type-check
node dist/cli.js new --no-interactive --name demo --skip-entity   # try the scaffold
```

The scaffold template is `src/templates/basic`; `src/templates/plugin` is the plugin template. Files ending in `.tmpl` get `{{placeholders}}` substituted; `_gitignore` is written as `.gitignore` (npm never publishes a file named `.gitignore`). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

Apache License 2.0. See [License.txt](License.txt).
