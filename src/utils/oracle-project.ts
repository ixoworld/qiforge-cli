import type { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { randomInt } from 'crypto';
import { readFileSync } from 'fs';
import {
  BLOCKSYNC_GRAPHQL_URL,
  DOMAIN_INDEXER_URL,
  FIRECRAWL_MCP_URL,
  MatrixHomeServerUrl,
  MEMORY_ENGINE_API,
  MEMORY_ENGINE_MCP,
  SANDBOX_API,
  SKILLS_CAPSULES_BASE_URL,
  UCAN_STORE_URL,
  VFS_BASE_URL,
} from './network-endpoints';
import type { ScaffoldVersions } from './runtime-versions';
import type { TemplateVars } from './template-renderer';

/**
 * Files of a scaffolded Workers oracle that hold provisioned values.
 *
 * - `.dev.vars`: the Worker's secrets for `wrangler dev` (and the source of
 *   `wrangler secret bulk` for a deployment).
 * - `oracle-credentials.env`: the operator's record of the oracle identity —
 *   its wallet mnemonic and Matrix credentials. Never read by the Worker,
 *   never uploaded; other CLI commands read it through `--env`.
 */
export const DEV_VARS_FILENAME = '.dev.vars';
export const CREDENTIALS_FILENAME = 'oracle-credentials.env';

/** The wrangler config templates that carry provisioned values. */
export const WRANGLER_CONFIG_TEMPLATES = ['wrangler.jsonc.tmpl', 'wrangler.gateway.jsonc.tmpl'] as const;

/** The identity of a provisioned oracle, as the wrangler `vars` carry it. */
export interface OracleIdentityVars {
  oracleDid: string;
  entityDid: string;
  matrixBaseUrl: string;
  matrixUserId: string;
  matrixRoomId: string;
}

/**
 * Identity placeholders for a scaffold made without provisioning
 * (`qiforge-cli new --skip-entity`). They have the shapes the runtime's env
 * schema accepts, so `wrangler dev` boots and serves `/health`, but they
 * name no real oracle: replace them (or re-scaffold without the flag).
 */
export function placeholderIdentity(network: NETWORK): OracleIdentityVars {
  const homeServer = MatrixHomeServerUrl[network];
  const serverName = new URL(homeServer).hostname;
  return {
    oracleDid: 'did:ixo:ixo1replacewithyouroracleaddress',
    entityDid: 'did:ixo:entity:00000000000000000000000000000000',
    matrixBaseUrl: homeServer,
    matrixUserId: `@replace-with-your-oracle-bot:${serverName}`,
    matrixRoomId: `!replace-with-your-account-room:${serverName}`,
  };
}

/** A Worker script name: lower-case letters, digits and dashes. */
export function toWorkerName(projectName: string): string {
  return projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The Matrix server name of a user id (`@bot:example.org` → `example.org`). */
export function serverNameOfUserId(userId: string): string {
  const index = userId.indexOf(':');
  if (!userId.startsWith('@') || index === -1) {
    throw new Error(`Not a Matrix user id: ${userId}`);
  }
  return userId.slice(index + 1);
}

/** A fresh `ratelimits.namespace_id`: a positive integer, unique per oracle on an account. */
export function generateRateLimitNamespaceId(): string {
  return String(randomInt(100_000, 2_000_000_000));
}

export interface ProjectTemplateInput {
  projectName: string;
  oracleName: string;
  org: string;
  description: string;
  network: NETWORK;
  versions: ScaffoldVersions;
  identity: OracleIdentityVars;
  rateLimitNamespaceId: string;
}

/**
 * A JSON string literal (valid in package.json, JSONC and TypeScript alike,
 * whatever quotes or backslashes the user typed) with every character above
 * U+00FF written as a `\u` escape. The values land in `src/config.ts`, so
 * they end up in the Worker bundle: one character above U+00FF there makes
 * V8 hold the whole bundle source at two bytes per character.
 */
export function latin1JsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u0100-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Every `{{placeholder}}` the `basic` template uses. */
export function buildProjectTemplateVars(input: ProjectTemplateInput): TemplateVars {
  const { network, identity, versions } = input;
  const workerName = toWorkerName(input.projectName);
  return {
    name: input.projectName,
    workerName,
    gatewayWorkerName: `${workerName}-gateway`,
    oracleNameJson: latin1JsonString(input.oracleName),
    orgJson: latin1JsonString(input.org),
    descriptionJson: latin1JsonString(input.description),
    org: input.org,
    description: input.description,
    network,
    rateLimitNamespaceId: input.rateLimitNamespaceId,
    oracleDid: identity.oracleDid,
    entityDid: identity.entityDid,
    matrixBaseUrl: identity.matrixBaseUrl,
    matrixServerName: serverNameOfUserId(identity.matrixUserId),
    matrixUserId: identity.matrixUserId,
    matrixRoomId: identity.matrixRoomId,
    blocksyncUrl: BLOCKSYNC_GRAPHQL_URL[network],
    vfsBaseUrl: VFS_BASE_URL[network],
    ucanStoreUrl: UCAN_STORE_URL[network],
    memoryMcpUrl: MEMORY_ENGINE_MCP[network],
    memoryEngineUrl: MEMORY_ENGINE_API[network],
    firecrawlMcpUrl: FIRECRAWL_MCP_URL,
    domainIndexerUrl: DOMAIN_INDEXER_URL[network],
    sandboxMcpUrl: SANDBOX_API[network],
    skillsCapsulesUrl: SKILLS_CAPSULES_BASE_URL,
    ...versions,
  };
}

/** One `KEY=value` line of a dotenv file, quoted when the value needs it. */
export function envLine(key: string, value: string): string {
  if (/[\s#"'\\]/.test(value)) {
    return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `${key}=${value}`;
}

export interface DevVarsInput {
  matrixPassword: string;
  matrixRecoveryPhrase: string;
  matrixPin: string;
  composioApiKey?: string;
}

/** `.dev.vars` for a provisioned oracle: exactly the Worker's secrets. */
export function buildDevVars(input: DevVarsInput): string {
  return [
    '# Secrets for `wrangler dev`, written by qiforge-cli. Never commit this file.',
    '# Deploy them with `pnpm exec wrangler secret bulk .dev.vars` (oracle script)',
    '# and the three MATRIX_* values with `wrangler secret put … -c wrangler.gateway.jsonc`.',
    '# See .dev.vars.example for what each one is.',
    envLine('MATRIX_ORACLE_ADMIN_PASSWORD', input.matrixPassword),
    envLine('MATRIX_RECOVERY_PHRASE', input.matrixRecoveryPhrase),
    envLine('MATRIX_VALUE_PIN', input.matrixPin),
    '',
    '# Platform LLM key (https://openrouter.ai/keys) — fill in before `pnpm dev`.',
    'OPEN_ROUTER_API_KEY=',
    '',
    input.composioApiKey
      ? envLine('COMPOSIO_API_KEY', input.composioApiKey)
      : '# COMPOSIO_API_KEY=   (create one with `qiforge-cli create-composio-key`)',
    '',
  ].join('\n');
}

export interface OracleCredentials {
  network: NETWORK;
  oracleAddress: string;
  oracleDid: string;
  entityDid: string;
  secpMnemonic: string;
  signingMnemonic: string;
  matrixBaseUrl: string;
  matrixUserId: string;
  matrixPassword: string;
  matrixRoomId: string;
  matrixPin: string;
  matrixRecoveryPhrase: string;
  matrixMnemonic: string;
}

/** `oracle-credentials.env`: the operator's complete record of the oracle identity. */
export function buildCredentialsFile(c: OracleCredentials): string {
  return [
    '# The oracle identity qiforge-cli provisioned. Not read by the Worker.',
    '# Back this file up somewhere safe: SECP_MNEMONIC controls the oracle\'s',
    '# account and DID document. Never commit it or upload it as a secret.',
    '# Other qiforge-cli commands read it with `--env oracle-credentials.env`.',
    envLine('NETWORK', c.network),
    envLine('ORACLE_ADDRESS', c.oracleAddress),
    envLine('ORACLE_DID', c.oracleDid),
    envLine('ORACLE_ENTITY_DID', c.entityDid),
    envLine('SECP_MNEMONIC', c.secpMnemonic),
    '# Ed25519 UCAN signing key (also stored PIN-encrypted in the account room;',
    '# its public key is a verification method on ORACLE_DID).',
    envLine('ORACLE_SIGNING_MNEMONIC', c.signingMnemonic),
    envLine('MATRIX_BASE_URL', c.matrixBaseUrl),
    envLine('MATRIX_ORACLE_ADMIN_USER_ID', c.matrixUserId),
    envLine('MATRIX_ORACLE_ADMIN_PASSWORD', c.matrixPassword),
    envLine('MATRIX_ACCOUNT_ROOM_ID', c.matrixRoomId),
    envLine('MATRIX_VALUE_PIN', c.matrixPin),
    envLine('MATRIX_RECOVERY_PHRASE', c.matrixRecoveryPhrase),
    envLine('MATRIX_MNEMONIC', c.matrixMnemonic),
    '',
  ].join('\n');
}

/** Minimal dotenv parser: `KEY=value` lines, `#` comments, optional quotes. */
export function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function parseEnvFile(filePath: string): Record<string, string> {
  return parseEnvContent(readFileSync(filePath, 'utf8'));
}
