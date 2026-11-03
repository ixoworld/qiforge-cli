# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QiForge CLI — a Node.js CLI tool for provisioning AI Agent oracles on the IXO blockchain and scaffolding their projects. It creates blockchain entities, the oracle's DID (with its Ed25519 UCAN signing key) and Matrix account, and scaffolds a Cloudflare Workers oracle on `@ixo/oracle-runtime-workers` from the bundled template (`src/templates/basic`). The deprecated Node runtime (`@ixo/oracle-runtime`) is no longer scaffolded. Requires Node.js 22+. Supports two authentication modes: SignX (QR code via IXO Mobile App) or offline wallet (local mnemonic + Matrix password).

## Build & Development Commands

| Command | Purpose |
|---|---|
| `pnpm build` | Build with esbuild (`build.mjs`: single ESM bundle → `dist/cli.js`, templates copied to `dist/templates`) |
| `pnpm dev` | Watch mode build |
| `pnpm start` | Run the built CLI (`node dist/cli.js`) |
| `pnpm test` | Run tests with Jest (ts-jest) |
| `pnpm lint` | ESLint on `src/**/*.ts` |
| `pnpm type-check` | `tsc --noEmit` |

The binary name is `qiforge-cli`. Build produces a single `dist/cli.js` with shebang.

## Architecture

### Command System

All commands implement `Command` interface (`src/commands/index.ts`) and return `CLIResult { success, data?, error? }`. Commands are registered in `CLIManager.registerCommands()` in `src/cli.ts`.

**Entry flow** (`src/cli.ts` → `CLIManager`):
1. Parse args: `new` scaffolds (no login with `--skip-entity`), `plugin new` and `setup-signing-key` run without login, `offline-login` triggers offline auth, `--help` shows help (never touches `~/.wallet.json`), no args → interactive select menu
2. `handleAuthentication()` checks for persisted wallet (`~/.wallet.json`), prompts login choice (SignX or Offline) if missing
3. `registerCommands()` instantiates and registers all commands
4. Route to selected command's `execute()` method

**Non-interactive mode**: Commands support `--no-interactive` flag + CLI flags via `parseCliFlags()` (`src/utils/cli-flags.ts`) for CI/CD pipelines. Flags use `--key value` or `--key=value` syntax.

**Adding a new command**: Create `src/commands/your-command.command.ts` implementing `Command`, register it in `CLIManager.registerCommands()`. See `docs/DEVELOPMENT.md` for detailed guide.

### Key Components

- **`Wallet`** (`src/utils/wallet.ts`) — Persists login state to `~/.wallet.json`. Supports two modes via `WalletProps.mode`: `'signx'` (default, QR-based) and `'offline'` (local mnemonic). The `signAndBroadcast(msgs)` method abstracts signing — delegates to SignX QR flow or local `signAndBroadcastWithMnemonic()`. All command code calls `wallet.signAndBroadcast()` instead of touching `signXClient` directly.
- **`OfflineLoginCommand`** (`src/commands/offline-login.command.ts`) — Login flow for offline mode: prompts for mnemonic, display name, Matrix username/password. Derives wallet via `getSecpClient()`, authenticates Matrix via `mxLoginRaw()`, persists with `mode: 'offline'`. Supports CLI flags (`--mnemonic`, `--matrixPassword`, `--network`, `--name`) for non-interactive use.
- **`RuntimeConfig`** (`src/utils/runtime-config.ts`) — Singleton for transient per-session state (projectPath, network, entityDid, registerUserResult). Use `config.addValue(key, value)` / `config.getOrThrow(key)`.
- **`SignXClient`** (`src/utils/signx/signx.ts`) — Wraps `@ixo/signx-sdk`. Used only in SignX mode. Flow: `transact()` → `displayTransactionQRCode()` → `pollNextTransaction()` → `awaitTransaction()`.
- **`CreateEntity`** (`src/utils/entity.ts`) — Core service for oracle entity provisioning. Orchestrates profile upload to Matrix, user registration, `MsgCreateEntity` broadcast, domain card/AuthZ/fees linked resource creation.
- **`registerUserSimplified()`** (`src/utils/account/simplifiedRegistration.ts`) — Creates a complete oracle identity: generates mnemonic → secp wallet → funds account → creates IID on-chain with the Ed25519 UCAN signing key as a verification method → provisions Matrix account with E2EE → stores the encrypted Matrix mnemonic and the encrypted signing mnemonic (`encrypted_mnemonic_ed_signing`) as account-room state.
- **Signing key** (`src/utils/account/signing-key.ts`, `signing-key-provision.ts`) — derivation (SHA-256 of the mnemonic → Ed25519 seed, the `@ixo/ucan` `signerFromMnemonic` contract, pinned by golden-vector tests), the IID verification, room storage. The Workers runtime only reads the key; the CLI provisions it (`setup-signing-key` for older oracles).
- **Scaffold** (`src/commands/new.command.ts`, `src/utils/oracle-project.ts`, `src/utils/runtime-versions.ts`) — renders `src/templates/basic` with `SCAFFOLD_VERSIONS` (one exact runtime release and the companion versions from its npm manifest), then re-renders the wrangler configs with the provisioned identity and writes `.dev.vars` + `oracle-credentials.env` (`src/utils/provisioned-project-files.ts`).
- **Oracle Matrix sessions** (`src/utils/oracle-matrix-session.ts`) — Workers oracles have no stored access token; commands log the oracle's account in with its password, act, and log the device out.
- **`parseCliFlags()`** (`src/utils/cli-flags.ts`) — Simple flag parser for `process.argv`. Supports `--key value`, `--key=value`, and `--boolean-flag` syntax. Used by commands to support non-interactive mode.

### External Dependencies Pattern

- **Matrix as content store**: JSON documents (profile, domain card, configs) are uploaded to Matrix as unencrypted media. The `mxc://` URL becomes the `serviceEndpoint` in blockchain `LinkedResource`. `proof` field is a CID, not a signature.
- **Two Matrix roles**: The logged-in user's Matrix account (from SignX) handles media uploads. The oracle gets its own dedicated Matrix account provisioned by `registerUserSimplified()`.
- **Dual signing modes**: In SignX mode, all user transactions require mobile QR scanning. In offline mode, transactions are signed locally with the stored mnemonic via `signAndBroadcastWithMnemonic()`. The `Wallet.signAndBroadcast()` method abstracts this — commands are mode-agnostic. The oracle's own IID is always created with `signAndBroadcastWithMnemonic()` using its newly generated mnemonic regardless of mode.

### Conventions

- Interactive prompts use `@clack/prompts` (`p.group()`, `p.text()`, `p.select()`, `p.spinner()`)
- Commands support non-interactive mode via `parseCliFlags()` — check `flags['no-interactive'] === 'true'` then use flag values with fallback to prompts
- Input validation uses Zod via helpers in `src/utils/common.ts` (`checkRequiredString`, `checkRequiredURL`, `checkRequiredNumber`, `checkIsEntityDid`, `checkRequiredPin`) — these return `string | undefined` to match clack's validation API
- Network URLs are constants keyed by `NETWORK` (`devnet | testnet | mainnet`): service endpoints the scaffold writes into wrangler `vars` live in the dependency-free `src/utils/network-endpoints.ts` (re-exported by `src/utils/common.ts`), the rest (RPC, bots, protocol DIDs) in `common.ts`
- Unit tests run under ts-jest (CommonJS): modules they import must not pull in ESM-only packages (`@clack/prompts`, `@cosmjs/*`, `@ixo/impactxclient-sdk`); keep testable logic in dependency-free modules
- Error handling uses custom classes in `src/utils/errors.ts` with `handleError()` utility
- Constructor injection for `Wallet` and `RuntimeConfig` into commands
- Template `.ts` files carry a `.tmpl` suffix so the CLI's own `tsc`, jest and eslint never pick them up; `_gitignore` renders as `.gitignore` (npm drops `.gitignore` files from published packages)
