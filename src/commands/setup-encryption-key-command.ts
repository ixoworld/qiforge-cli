import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import { parseCliFlags } from '../utils/cli-flags';
import {
  checkIsEntityDid,
  checkRequiredPin,
  selectNetwork,
} from '../utils/common';
import {
  activateEncryptionKey,
  buildAddKeyAgreementMsg,
  encryptionKeyExists,
  prepareEncryptionKey,
} from '../utils/encryption-key';
import {
  loadOracleMatrixCredentials,
  promptOracleMatrixCredentials,
  withOracleMatrixToken,
} from '../utils/oracle-matrix-session';
import { RuntimeConfig } from '../utils/runtime-config';
import { Wallet } from '../utils/wallet';

export class SetupEncryptionKeyCommand implements Command {
  name = 'setup-encryption-key';
  description = 'Setup P-256 encryption key for an existing oracle (keyAgreement)';

  constructor(
    private wallet: Wallet,
    private config: RuntimeConfig,
  ) {}

  async execute(): Promise<CLIResult> {
    const network = this.config.getValue('network') as NETWORK;
    if (!network) {
      await selectNetwork(this.config);
    }

    const results = await p.group(
      {
        entityDid: () =>
          p.text({
            message: 'Oracle entity DID (ORACLE_ENTITY_DID in wrangler.jsonc):',
            initialValue:
              this.config.getValue('entityDid')?.toString() ?? '',
            validate(value) {
              return checkIsEntityDid(value);
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

    const flags = parseCliFlags();
    const matrix = flags.env ? loadOracleMatrixCredentials(flags.env) : await promptOracleMatrixCredentials();
    const { homeServerUrl, roomId } = matrix;

    try {
      const signerAddress = this.wallet.wallet?.address;
      if (!signerAddress) {
        throw new Error(
          'Wallet not available. Please login first.',
        );
      }

      const encKeyResult = await withOracleMatrixToken(matrix, async (accessToken) => {
        // 1. Check if key already exists and is active
        p.log.info('Checking for existing encryption key...');
        const keyAlreadyExists = await encryptionKeyExists(
          roomId,
          accessToken,
          homeServerUrl,
        );

        if (keyAlreadyExists) {
          p.log.info(
            'Encryption key already exists for this oracle. No action needed.',
          );
          return undefined;
        }

        // 2. Prepare keypair (generates new or reuses existing inactive key)
        p.log.info('Preparing P-256 encryption keypair...');
        const encKeyResult = await prepareEncryptionKey({
          roomId: roomId,
          accessToken: accessToken,
          homeServerUrl,
          pin: results.pin,
          oracleEntityDid: results.entityDid,
        });
        p.log.success('Encryption key prepared in Matrix room');

        // 3. Build and sign MsgAddVerification via SignX
        const addKeyMsg = buildAddKeyAgreementMsg({
          oracleEntityDid: results.entityDid,
          verificationMethodId: encKeyResult.verificationMethodId,
          publicKeyMultibase: encKeyResult.publicKeyMultibase,
          signerAddress,
        });

        p.log.info(
          'Sign to add P-256 encryption key (keyAgreement) to the entity',
        );
        await this.wallet.signAndBroadcast([addKeyMsg]);

        // 4. Mark key as active only after chain confirmation
        await activateEncryptionKey({
          roomId: roomId,
          accessToken: accessToken,
          homeServerUrl,
          verificationMethodId: encKeyResult.verificationMethodId,
        });
        return encKeyResult;
      });
      if (!encKeyResult) {
        return { success: true, data: 'Encryption key already exists' };
      }

      p.log.success(
        `P-256 encryption key published to entity DID: ${results.entityDid}`,
      );
      p.log.info(
        `Verification method ID: ${encKeyResult.verificationMethodId}`,
      );

      return {
        success: true,
        data: `Encryption key setup complete for ${results.entityDid}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
