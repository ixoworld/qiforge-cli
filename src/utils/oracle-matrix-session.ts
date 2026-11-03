/**
 * Short-lived Matrix sessions on the oracle's own account.
 *
 * A Workers oracle has no long-lived access token: its gateway logs its own
 * devices in with `MATRIX_ORACLE_ADMIN_PASSWORD` and rotates them. CLI
 * commands that write to the oracle's account room (Agent Card upload,
 * encryption key, signing key) therefore log in with the password, do their
 * work, and log the device out again so no stray CLI device stays on the
 * account. An explicit access token is still accepted (oracles provisioned
 * for the Node runtime kept one in `.env`).
 */
import * as p from '@clack/prompts';
import { checkRequiredString } from './common';
import { deriveHomeServerUrl } from './encryption-key';
import { parseEnvFile } from './oracle-project';

export type OracleMatrixAuth =
  | { accessToken: string }
  | { userId: string; password: string };

export interface OracleMatrixCredentials {
  homeServerUrl: string;
  roomId: string;
  auth: OracleMatrixAuth;
}

const DEVICE_NAME = 'qiforge-cli (temporary)';

async function login(homeServerUrl: string, userId: string, password: string): Promise<string> {
  const res = await fetch(`${homeServerUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: userId },
      password,
      initial_device_display_name: DEVICE_NAME,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Matrix login as ${userId} failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Matrix login returned no access token');
  return data.access_token;
}

async function logout(homeServerUrl: string, accessToken: string): Promise<void> {
  const res = await fetch(`${homeServerUrl}/_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    console.warn(`⚠  Could not log the temporary CLI device out (${res.status}); remove it from the account's devices.`);
  }
}

/**
 * Runs `work` with an access token for the oracle's account. With a password
 * it logs a temporary device in first and always logs it out afterwards.
 */
export async function withOracleMatrixToken<T>(
  credentials: OracleMatrixCredentials,
  work: (accessToken: string) => Promise<T>,
): Promise<T> {
  if ('accessToken' in credentials.auth) return work(credentials.auth.accessToken);
  const token = await login(credentials.homeServerUrl, credentials.auth.userId, credentials.auth.password);
  try {
    return await work(token);
  } finally {
    await logout(credentials.homeServerUrl, token);
  }
}

/**
 * Oracle Matrix credentials from an env file: `oracle-credentials.env`
 * (written by `qiforge-cli new`) or a Node-era `.env`. Needs
 * `MATRIX_ACCOUNT_ROOM_ID` plus either `MATRIX_ORACLE_ADMIN_USER_ID` +
 * `MATRIX_ORACLE_ADMIN_PASSWORD` or `MATRIX_ORACLE_ADMIN_ACCESS_TOKEN`.
 */
export function oracleMatrixCredentialsFromEnv(env: Record<string, string>, source: string): OracleMatrixCredentials {
  const roomId = env.MATRIX_ACCOUNT_ROOM_ID;
  if (!roomId) throw new Error(`${source} has no MATRIX_ACCOUNT_ROOM_ID`);
  const homeServerUrl = env.MATRIX_BASE_URL || deriveHomeServerUrl(roomId);
  if (env.MATRIX_ORACLE_ADMIN_USER_ID && env.MATRIX_ORACLE_ADMIN_PASSWORD) {
    return {
      homeServerUrl,
      roomId,
      auth: { userId: env.MATRIX_ORACLE_ADMIN_USER_ID, password: env.MATRIX_ORACLE_ADMIN_PASSWORD },
    };
  }
  if (env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN) {
    return { homeServerUrl, roomId, auth: { accessToken: env.MATRIX_ORACLE_ADMIN_ACCESS_TOKEN } };
  }
  throw new Error(
    `${source} needs MATRIX_ORACLE_ADMIN_USER_ID + MATRIX_ORACLE_ADMIN_PASSWORD (or MATRIX_ORACLE_ADMIN_ACCESS_TOKEN)`,
  );
}

export function loadOracleMatrixCredentials(envPath: string): OracleMatrixCredentials {
  return oracleMatrixCredentialsFromEnv(parseEnvFile(envPath), envPath);
}

/**
 * Asks for the oracle's Matrix account: the account room and the bot's
 * user id (both in wrangler.jsonc `vars`) and its password (`.dev.vars`).
 */
export async function promptOracleMatrixCredentials(): Promise<OracleMatrixCredentials> {
  const answers = await p.group(
    {
      roomId: () =>
        p.text({
          message: 'Oracle Matrix account room (MATRIX_ACCOUNT_ROOM_ID in wrangler.jsonc):',
          placeholder: '!abc123:devmx.ixo.earth',
          validate(value) {
            if (!value || !value.startsWith('!') || !value.includes(':')) {
              return 'Matrix room ID must be in format !roomId:server (e.g. !abc123:devmx.ixo.earth)';
            }
            return undefined;
          },
        }),
      userId: () =>
        p.text({
          message: 'Oracle Matrix user id (MATRIX_ORACLE_ADMIN_USER_ID in wrangler.jsonc):',
          placeholder: '@did-ixo-ixo1...:devmx.ixo.earth',
          validate(value) {
            if (!value || !value.startsWith('@') || !value.includes(':')) {
              return 'Matrix user id must be in format @user:server';
            }
            return undefined;
          },
        }),
      password: () =>
        p.password({
          message: 'Oracle Matrix password (MATRIX_ORACLE_ADMIN_PASSWORD in .dev.vars):',
          validate(value) {
            return checkRequiredString(value, 'Matrix password is required');
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
  return {
    homeServerUrl: deriveHomeServerUrl(answers.roomId),
    roomId: answers.roomId,
    auth: { userId: answers.userId, password: answers.password },
  };
}
