import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import { ensureSigningKeyOnChain } from '../utils/account/signing-key-provision';
import { getSecpClient } from '../utils/account/utils';
import { parseCliFlags } from '../utils/cli-flags';
import { checkRequiredPin, checkRequiredString, selectNetwork } from '../utils/common';
import { fetchOrCreateEdMnemonic } from '../utils/composio';
import {
  type OracleMatrixCredentials,
  oracleMatrixCredentialsFromEnv,
  promptOracleMatrixCredentials,
  withOracleMatrixToken,
} from '../utils/oracle-matrix-session';
import { parseEnvFile } from '../utils/oracle-project';
import { RuntimeConfig } from '../utils/runtime-config';

interface SigningKeyInputs {
  secpMnemonic: string;
  pin: string;
  matrix: OracleMatrixCredentials;
}

/**
 * `qiforge-cli setup-signing-key` — gives an existing oracle the Ed25519 UCAN
 * signing key the Workers runtime needs.
 *
 * The runtime signs every downstream UCAN invocation (owner copy in the VFS,
 * memory engine, sandbox) with an Ed25519 key, and the services verify it
 * against the oracle's DID document. Oracles created by `qiforge-cli new`
 * since 2.0.0 get the key at creation; older ones carry only secp256k1 keys
 * (the Node runtime added the Ed25519 key on its first boot, the Workers
 * runtime does not). This command reads the key from the oracle's account
 * room — or creates and stores it there, PIN-encrypted — and adds its public
 * key to the oracle's DID document, signed by the oracle's own account.
 * Idempotent. Needs no user login: it acts only with the oracle's keys.
 */
export class SetupSigningKeyCommand implements Command {
  name = 'setup-signing-key';
  description = "Give an existing oracle the Ed25519 UCAN signing key the Workers runtime needs";

  constructor(private readonly config: RuntimeConfig) {}

  private async inputs(flags: Record<string, string>): Promise<SigningKeyInputs> {
    if (flags.env) {
      const env = parseEnvFile(flags.env);
      const missing = ['SECP_MNEMONIC', 'MATRIX_VALUE_PIN'].filter((key) => !env[key]);
      if (missing.length > 0) throw new Error(`${flags.env} is missing: ${missing.join(', ')}`);
      return {
        secpMnemonic: env.SECP_MNEMONIC as string,
        pin: env.MATRIX_VALUE_PIN as string,
        matrix: oracleMatrixCredentialsFromEnv(env, flags.env),
      };
    }
    if (flags['no-interactive'] === 'true') {
      throw new Error('--no-interactive requires --env <oracle-credentials.env>');
    }
    const keys = await p.group(
      {
        secpMnemonic: () =>
          p.password({
            message: 'Oracle wallet mnemonic (SECP_MNEMONIC in oracle-credentials.env):',
            validate(value) {
              return checkRequiredString(value, 'Oracle mnemonic is required');
            },
          }),
        pin: () =>
          p.password({
            message: 'Oracle PIN (MATRIX_VALUE_PIN in .dev.vars):',
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
    return { ...keys, matrix: await promptOracleMatrixCredentials() };
  }

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();
      let network = (flags.network as NETWORK | undefined) ?? (this.config.getValue('network') as NETWORK | undefined);
      if (!network) {
        network = flags['no-interactive'] === 'true' ? 'devnet' : await selectNetwork(this.config);
      }
      if (network !== 'devnet' && network !== 'testnet' && network !== 'mainnet') {
        throw new Error(`Invalid network "${String(network)}" (devnet, testnet or mainnet)`);
      }

      const { secpMnemonic, pin, matrix } = await this.inputs(flags);
      const oracleSigner = await getSecpClient(secpMnemonic.trim());
      const did = oracleSigner.did;
      p.log.info(`Oracle DID: ${did}`);

      const signingMnemonic = await withOracleMatrixToken(matrix, (matrixAccessToken) =>
        fetchOrCreateEdMnemonic({
          matrixHomeServerUrl: matrix.homeServerUrl,
          matrixAccessToken,
          matrixRoomId: matrix.roomId,
          pin,
        }),
      );
      p.log.success('Signing mnemonic ready in the account room');

      const status = await ensureSigningKeyOnChain({ did, signingMnemonic, oracleSigner, network });
      p.log.success(
        status === 'added'
          ? `Ed25519 signing key added to ${did}`
          : `Ed25519 signing key already on ${did} — nothing to do`,
      );
      p.log.info(
        'The runtime reads the key from the account room (MATRIX_ACCOUNT_ROOM_ID + MATRIX_VALUE_PIN); ' +
          'restart the oracle (or redeploy) so its user objects pick it up.',
      );
      return { success: true, data: `Signing key ${status} on ${did}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
