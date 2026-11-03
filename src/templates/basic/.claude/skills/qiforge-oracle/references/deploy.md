# Run locally and deploy

## The two scripts

| Config | Entry | Holds |
| --- | --- | --- |
| `wrangler.jsonc` | `src/index.ts` | the HTTP shell, `UserOracleDO` (one per user), the rate limit, the daily cron |
| `wrangler.gateway.jsonc` | `src/gateway.ts` | `MatrixGatewayDO` (the bot), the 5-minute keep-alive cron |

`MATRIX_GATEWAY` in the oracle script and `USER_ORACLE` in the gateway script are cross-script bindings (`script_name`). Splitting keeps the bot's memory (matrix-js-sdk, crypto WASM, sync store) out of the user objects' isolates.

## Local

```bash
pnpm install
pnpm dev     # wrangler dev -c wrangler.jsonc -c wrangler.gateway.jsonc → http://localhost:8787
curl http://localhost:8787/health
```

`.dev.vars` feeds both scripts. Every route except `/health` (and the public artefact and status routes) needs a UCAN invocation; a plain `curl /sessions` answers 401.

## Deploy

Needs the Cloudflare **Workers Paid** plan (Durable Objects with `limits.cpu_ms` 300000).

```bash
pnpm exec wrangler login
pnpm run deploy                                    # gateway script first, then the oracle script
pnpm exec wrangler secret bulk .dev.vars           # oracle script secrets
pnpm exec wrangler secret put MATRIX_ORACLE_ADMIN_PASSWORD -c wrangler.gateway.jsonc
pnpm exec wrangler secret put MATRIX_RECOVERY_PHRASE -c wrangler.gateway.jsonc
pnpm exec wrangler secret put MATRIX_VALUE_PIN -c wrangler.gateway.jsonc
curl https://<oracle>.<subdomain>.workers.dev/health
qiforge-cli update-oracle-api-url                  # point the entity's #api / #ws services at the deployed URL
```

On a first deploy the order matters: the oracle script's `MATRIX_GATEWAY` binding names the gateway script, which must exist. To pin the account, add `"account_id"` to both configs or set `CLOUDFLARE_ACCOUNT_ID`.

Optional resources (uncomment in `wrangler.jsonc` after creating them): `TIER_BUCKET` (R2 page tier: removes the 10 GB per-user Durable Object cap) and `ARTIFACT_BUCKET` + `ORACLE_PUBLIC_URL` (encrypted links for long chat replies):

```bash
pnpm exec wrangler r2 bucket create <oracle>-tier
pnpm exec wrangler r2 bucket create <oracle>-artifacts
```

## Memory: why `minify` stays on

Each Durable Object isolate has 128 MB of heap. The runtime's bundle is large; minified it costs roughly 30 MB less heap before the first turn than unminified (measured on a production oracle's user object: about 54 MB vs 87 MB), and a user object that crosses 128 MB is reset mid-turn. Both wrangler configs set `"minify": true`. Wrangler keeps function and class names while minifying (`keep_names` defaults to `true`), so the Durable Object class exports and LangChain's name-based serialization keep working; never set `"keep_names": false`.

Keep the bundle Latin-1. V8 stores a script's source at one byte per character only when every character is at most U+00FF; one character above that (an emoji, a curly quote, an em dash in a string literal) makes it two bytes per character for the whole multi-megabyte source. The runtime's own literals are Latin-1 since 0.37.0, so keep yours that way too: write such characters as `\u` escapes in strings (comments are stripped by the minifier). Check after `pnpm run build`:

```bash
node -e "const s=require('fs').readFileSync('dist/oracle/index.js','utf8');console.log((s.match(/[^\u0000-\u00ff]/g)||[]).length)"   # must print 0
```

## Upgrading the runtime

1. Bump `@ixo/oracle-runtime-workers` (exact version) and set `@ixo/matrix-bot-workers-sdk` to the exact version that runtime release depends on (`npm view @ixo/oracle-runtime-workers@<v> dependencies`).
2. Read the runtime's CHANGELOG for wrangler config changes (new bindings, migrations, vars).
3. `pnpm install && pnpm typecheck && pnpm test && pnpm run build`.
4. Check the bundle holds one copy of yjs (`grep -c "Yjs was already imported" dist/oracle/index.js` prints `1`) and no character above U+00FF (the check above prints `0`).
5. Never move to `0.36.0`: it contains a change that 0.36.1 reverted.
