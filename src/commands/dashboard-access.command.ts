import * as p from '@clack/prompts';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { cosmos, utils } from '@ixo/impactxclient-sdk';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { readFileSync } from 'fs';
import { Command } from '.';
import { CLIResult } from '../types';
import {
  getSecpClient,
  signAndBroadcastWithMnemonic,
} from '../utils/account/utils';
import { parseCliFlags } from '../utils/cli-flags';
import {
  checkIsEntityDid,
  checkIsIidDid,
  checkRequiredPin,
  checkRequiredString,
  EVAL_ENGINE_URL,
  selectNetwork,
} from '../utils/common';
import { fetchOrCreateEdMnemonic } from '../utils/composio';
import { deriveHomeServerUrl } from '../utils/encryption-key';
import { RuntimeConfig } from '../utils/runtime-config';

/** Short-lived, single-shot invocation — no reason to outlive the request. */
const INVOCATION_TTL_SEC = 300;

/** Deposit-funding grant: MsgAddPerformanceDeposit is signed by agent_address,
 *  so a standard x/authz GenericAuthorization + MsgExec works. */
const DEPOSIT_GRANT_MSG_TYPE = '/ixo.claims.v1beta1.MsgAddPerformanceDeposit';
const DEPOSIT_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

/** Account DIDs only — a `did:ixo:ixo1...` whose suffix IS the address. */
const ACCOUNT_DID_REGEX = /^did:ixo:(ixo1[a-z0-9]{38,58})$/;

function accountAddressFromDid(did: string): string | undefined {
  return ACCOUNT_DID_REGEX.exec(did)?.[1];
}

/** The oracle-project .env var names (match the oracle runtime's). */
const ENV_KEYS = [
  'SECP_MNEMONIC',
  'MATRIX_ORACLE_ADMIN_ACCESS_TOKEN',
  'MATRIX_ACCOUNT_ROOM_ID',
  'MATRIX_VALUE_PIN',
] as const;

interface OracleCredentials {
  secpMnemonic: string;
  matrixAccessToken: string;
  matrixRoomId: string;
  pin: string;
}

/** Minimal .env parser — KEY=value lines, #-comments, optional quotes. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadOracleCredentials(envPath: string): OracleCredentials {
  let env: Record<string, string>;
  try {
    env = parseEnvFile(envPath);
  } catch (error) {
    throw new Error(
      `Failed to read env file ${envPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const missing = ENV_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Env file ${envPath} is missing: ${missing.join(', ')}`);
  }
  return {
    secpMnemonic: env.SECP_MNEMONIC as string,
    matrixAccessToken: env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN as string,
    matrixRoomId: env.MATRIX_ACCOUNT_ROOM_ID as string,
    pin: env.MATRIX_VALUE_PIN as string,
  };
}

export class DashboardAccessCommand implements Command {
  name = 'dashboard-access';
  description = 'Link an oracle to a developer console account';
  // Manages its own UI lifecycle — no wrapper spinner / "completed" line
  interactive = true;

  constructor(private config: RuntimeConfig) {}

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();
      if (flags['no-interactive'] === 'true') {
        return await this.executeNonInteractive(flags);
      }
      return await this.executeInteractive(flags);
    } catch (error) {
      // End with a single, honest failure block — no "completed" noise after
      // a failure — and a non-zero exit.
      p.cancel(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // Interactive mode
  // -------------------------------------------------------------------------

  private async executeInteractive(flags: Record<string, string>): Promise<CLIResult> {
    let network = this.config.getValue('network') as NETWORK;
    if (!network) {
      network = await selectNetwork(this.config);
    }

    const base = await p.group(
      {
        dashboardDid: () =>
          p.text({
            message: "Your console account DID (copy it from the console's No-access screen):",
            placeholder: 'did:ixo:ixo1...',
            validate(value) {
              return checkIsIidDid(value);
            },
          }),
        entityDid: () =>
          p.text({
            message: 'Oracle entity DID (ORACLE_ENTITY_DID from .env):',
            initialValue: this.config.getValue('entityDid')?.toString() ?? '',
            validate(value) {
              return checkIsEntityDid(value);
            },
          }),
      },
      {
        onCancel: () => {
          p.cancel('Operation cancelled.');
          process.exit(0);
        },
      },
    );

    // Oracle credentials: wholesale from the project's .env, or prompted
    let creds: OracleCredentials;
    if (flags.env) {
      creds = loadOracleCredentials(flags.env);
      p.log.info(`Oracle credentials loaded from ${flags.env}`);
    } else {
      creds = await p.group(
        {
          secpMnemonic: () =>
            p.password({
              message: 'Oracle wallet mnemonic (SECP_MNEMONIC from .env):',
              validate(value) {
                return checkRequiredString(value, 'Oracle mnemonic is required');
              },
            }),
          matrixRoomId: () =>
            p.text({
              message: 'Oracle Matrix room ID (MATRIX_ACCOUNT_ROOM_ID from .env):',
              placeholder: '!abc123:devmx.ixo.earth',
              validate(value) {
                if (!value || !value.startsWith('!') || !value.includes(':')) {
                  return 'Matrix room ID must be in format !roomId:server (e.g. !abc123:devmx.ixo.earth)';
                }
                return checkRequiredString(value, 'Matrix room ID is required');
              },
            }),
          matrixAccessToken: () =>
            p.password({
              message: 'Oracle Matrix access token (MATRIX_ORACLE_ADMIN_ACCESS_TOKEN from .env):',
              validate(value) {
                return checkRequiredString(value, 'Matrix access token is required');
              },
            }),
          pin: () =>
            p.password({
              message: 'Oracle PIN (MATRIX_VALUE_PIN from .env):',
              validate(value) {
                return checkRequiredPin(value);
              },
            }),
        },
        {
          onCancel: () => {
            p.cancel('Operation cancelled.');
            process.exit(0);
          },
        },
      );
    }

    return this.linkDashboard({
      dashboardDid: base.dashboardDid,
      entityDid: base.entityDid,
      network,
      creds,
      depositGrant: 'prompt',
    });
  }

  // -------------------------------------------------------------------------
  // Non-interactive mode (--no-interactive --grant <did> --entity-did <did> --env <path>)
  // -------------------------------------------------------------------------

  private async executeNonInteractive(flags: Record<string, string>): Promise<CLIResult> {
    let network = (flags.network as NETWORK) ?? (this.config.getValue('network') as NETWORK);
    if (!network) network = 'devnet';
    this.config.addValue('network', network);

    const dashboardDid = flags.grant;
    const entityDid = flags['entity-did'];
    const envPath = flags.env;
    if (!dashboardDid || !entityDid || !envPath) {
      throw new Error(
        '--no-interactive requires --grant <dashboardDid>, --entity-did <did> and --env <path-to-oracle-project-.env>',
      );
    }
    const dashboardDidError = checkIsIidDid(dashboardDid);
    if (dashboardDidError) throw new Error(`--grant: ${dashboardDidError}`);
    const entityDidError = checkIsEntityDid(entityDid);
    if (entityDidError) throw new Error(`--entity-did: ${entityDidError}`);

    return this.linkDashboard({
      dashboardDid,
      entityDid,
      network,
      creds: loadOracleCredentials(envPath),
      depositGrant: flags['grant-deposit'] === 'true' ? 'grant' : 'skip',
    });
  }

  // -------------------------------------------------------------------------
  // The link: mint a UCAN invocation with the oracle's keys, POST to the engine
  // -------------------------------------------------------------------------

  private async linkDashboard({
    dashboardDid,
    entityDid,
    network,
    creds,
    depositGrant,
  }: {
    dashboardDid: string;
    entityDid: string;
    network: NETWORK;
    creds: OracleCredentials;
    depositGrant: 'prompt' | 'grant' | 'skip';
  }): Promise<CLIResult> {
    const homeServerUrl = deriveHomeServerUrl(creds.matrixRoomId);
    const s = p.spinner();

    // The oracle's SECP address is the invocation issuer identity; the engine
    // verifies it against the entity's on-chain #orz grantee.
    s.start('Deriving the oracle wallet address...');
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(creds.secpMnemonic, {
      prefix: 'ixo',
    });
    const [account] = await wallet.getAccounts();
    if (!account) {
      s.stop('Failed to derive the oracle wallet');
      throw new Error('Could not derive an account from SECP_MNEMONIC');
    }
    const issuerDid = `did:ixo:${account.address}` as const;
    s.stop(`Oracle wallet: ${account.address}`);

    // The Ed25519 claim-signing key signs the invocation (PIN-encrypted in the
    // oracle's Matrix account room state). Fetch-only: a freshly-minted key
    // would not be the runtime-provisioned one — fail loudly instead.
    s.start('Fetching the oracle claim-signing key from Matrix...');
    let edMnemonic: string;
    try {
      edMnemonic = await fetchOrCreateEdMnemonic(
        {
          matrixHomeServerUrl: homeServerUrl,
          matrixAccessToken: creds.matrixAccessToken,
          matrixRoomId: creds.matrixRoomId,
          pin: creds.pin,
        },
        { allowCreate: false },
      );
    } catch (error) {
      s.stop('Failed to fetch the claim-signing key');
      throw error;
    }
    s.stop('Claim-signing key ready');

    // Audience: the engine's did:web, resolved live — never hardcoded.
    s.start('Resolving the eval-engine DID...');
    const didRes = await fetch(`${EVAL_ENGINE_URL[network]}/.well-known/did.json`);
    if (!didRes.ok) {
      s.stop('Failed to resolve the eval-engine DID');
      throw new Error(`Failed to resolve the eval-engine DID (${didRes.status})`);
    }
    const engineDid = ((await didRes.json()) as { id?: string }).id;
    if (!engineDid) {
      s.stop('Failed to resolve the eval-engine DID');
      throw new Error('The eval-engine did.json has no id');
    }
    s.stop(`Engine DID: ${engineDid}`);

    s.start('Linking the oracle to your console account...');
    const { signerFromMnemonic, createInvocation, serializeInvocation } = await import(
      '@ixo/ucan'
    );
    const { signer } = await signerFromMnemonic(edMnemonic, issuerDid);
    // can: "*" — the engine's UCAN middleware claims {can: "*"} against every
    // invocation, which a narrower grant cannot satisfy (every other client
    // mints "*" too). Route-level access control is the on-chain #orz proof,
    // not the capability string.
    const invocation = await createInvocation({
      issuer: signer,
      audience: engineDid,
      capability: { can: '*', with: 'ixo:eval-engine' },
      expiration: Math.floor(Date.now() / 1000) + INVOCATION_TTL_SEC,
    });
    const token = await serializeInvocation(invocation);

    const res = await fetch(`${EVAL_ENGINE_URL[network]}/v1/dev/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Auth-Type': 'ucan',
      },
      body: JSON.stringify({ dashboardDid, oracleEntityDid: entityDid }),
    });

    if (!res.ok) {
      s.stop('Link failed');
      const detail = await res.text().catch(() => '');
      switch (res.status) {
        case 403:
          throw new Error(
            "This oracle's #orz authz config names a different account than your wallet — check you're in the right oracle project",
          );
        case 404:
          throw new Error(
            'No #orz found — publish the oracle (qiforge create-entity) before linking',
          );
        case 400:
          throw new Error(`Malformed dashboardDid${detail ? ` — ${detail}` : ''}`);
        default:
          throw new Error(`Link failed (${res.status})${detail ? `: ${detail}` : ''}`);
      }
    }

    s.stop('Linked');
    p.log.success(`✓ ${entityDid} linked to ${dashboardDid} — refresh the console.`);

    await this.maybeGrantDepositFunding({
      dashboardDid,
      network,
      creds,
      oracleAddress: account.address,
      mode: depositGrant,
    });

    return {
      success: true,
      data: `${entityDid} linked to ${dashboardDid}`,
    };
  }

  // -------------------------------------------------------------------------
  // Optional follow-up: authorize the console account to fund the oracle's
  // performance deposits (x/authz GenericAuthorization over
  // MsgAddPerformanceDeposit, signed by the oracle wallet)
  // -------------------------------------------------------------------------

  private async maybeGrantDepositFunding({
    dashboardDid,
    network,
    creds,
    oracleAddress,
    mode,
  }: {
    dashboardDid: string;
    network: NETWORK;
    creds: OracleCredentials;
    oracleAddress: string;
    mode: 'prompt' | 'grant' | 'skip';
  }): Promise<void> {
    if (mode === 'skip') {
      p.log.info(
        'Deposit funding not enabled — re-run dashboard-access with --grant-deposit to enable it.',
      );
      return;
    }
    if (mode === 'prompt') {
      const allow = await p.confirm({
        message: 'Allow this console account to fund performance deposits for this oracle?',
        initialValue: true,
      });
      if (p.isCancel(allow) || !allow) {
        p.log.info('Deposit funding skipped — re-run dashboard-access anytime to enable it.');
        return;
      }
    }

    // The grantee is the console account's ADDRESS — only account DIDs carry
    // one. An entity DID links fine, but cannot receive this grant.
    const grantee = accountAddressFromDid(dashboardDid);
    if (!grantee) {
      throw new Error(
        `The link succeeded, but deposit funding needs your console account DID (did:ixo:ixo1...) — "${dashboardDid}" is an entity DID. Re-run dashboard-access with the account DID from the console to enable it.`,
      );
    }

    const expiration = new Date(Date.now() + DEPOSIT_GRANT_TTL_MS);
    // Re-granting is safe: x/authz keeps one grant per (granter, grantee,
    // msgType) triple, so a re-run simply overwrites the existing grant.
    const grantMsg = {
      typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
      value: cosmos.authz.v1beta1.MsgGrant.fromPartial({
        granter: oracleAddress,
        grantee,
        grant: cosmos.authz.v1beta1.Grant.fromPartial({
          authorization: {
            typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
            value: cosmos.authz.v1beta1.GenericAuthorization.encode(
              cosmos.authz.v1beta1.GenericAuthorization.fromPartial({
                msg: DEPOSIT_GRANT_MSG_TYPE,
              }),
            ).finish(),
          },
          expiration: utils.proto.toTimestamp(expiration),
        }),
      }),
    };

    const s = p.spinner();
    s.start('Granting deposit-funding authorization...');
    try {
      const offlineSigner = await getSecpClient(creds.secpMnemonic);
      await signAndBroadcastWithMnemonic({
        offlineSigner,
        messages: [grantMsg],
        memo: 'Grant deposit funding to console account',
        feegrantGranter: '',
        network,
      });
    } catch (error) {
      s.stop('Failed to grant deposit funding');
      throw error;
    }
    s.stop('Deposit funding granted');
    p.log.success(
      `✓ deposit funding enabled for ${grantee} (expires ${expiration.toISOString().slice(0, 10)})`,
    );
  }
}
