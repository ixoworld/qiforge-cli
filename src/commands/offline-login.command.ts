import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import { createMatrixApiClient } from '@ixo/matrixclient-sdk';
import { generateUsernameFromAddress, generateUserRoomAliasFromAddress, mxLoginRaw } from '../utils/account/matrix';
import { getSecpClient } from '../utils/account/utils';
import { parseCliFlags } from '../utils/cli-flags';
import { MatrixHomeServerUrl, selectNetwork } from '../utils/common';
import { RuntimeConfig } from '../utils/runtime-config';
import { Wallet } from '../utils/wallet';

export class OfflineLoginCommand implements Command {
  name = 'offline-login';
  description = 'Login with a local mnemonic (offline wallet)';

  constructor(private config: RuntimeConfig, private wallet: Wallet) {}

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();

      // Use flag or prompt for network
      let network: NETWORK;
      if (flags.network) {
        network = flags.network as NETWORK;
        this.config.addValue('network', network);
      } else {
        network = await selectNetwork(this.config);
      }

      // Resolve mnemonic: flag or prompt
      const mnemonic = flags.mnemonic ?? await p.password({
        message: 'Enter your mnemonic phrase:',
        validate(value) {
          if (!value || value.trim().split(/\s+/).length < 12) {
            return 'Mnemonic must be at least 12 words';
          }
          return undefined;
        },
      }) as string;

      if (p.isCancel(mnemonic)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      // Resolve Matrix password: flag or prompt
      const matrixPassword = flags.matrixPassword ?? await p.password({
        message: 'Matrix password:',
        validate(value) {
          if (!value?.trim()) return 'Matrix password is required';
          return undefined;
        },
      }) as string;

      if (p.isCancel(matrixPassword)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      // Derive wallet from mnemonic
      const secpClient = await getSecpClient(mnemonic);
      const account = secpClient.baseAccount;

      // Derive Matrix username from address
      const username = generateUsernameFromAddress(account.address);

      // Login to Matrix
      const homeServerUrl = MatrixHomeServerUrl[network as NETWORK];
      p.log.info(`Logging into Matrix as @${username}:${new URL(homeServerUrl).host}...`);
      let matrixLogin: Awaited<ReturnType<typeof mxLoginRaw>>;
      try {
        matrixLogin = await mxLoginRaw({
          homeServerUrl,
          username,
          password: matrixPassword,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        p.log.error(`Matrix login failed for @${username}:${new URL(homeServerUrl).host}: ${message}`);
        throw err;
      }

      // Resolve room ID from room alias
      const matrixApiClient = createMatrixApiClient({
        homeServerUrl,
        accessToken: matrixLogin.accessToken,
      });
      const mxRoomAlias = generateUserRoomAliasFromAddress(account.address, homeServerUrl);
      const queryIdResponse = await matrixApiClient.room.v1beta1.queryId(mxRoomAlias).catch(() => undefined);
      const roomId = queryIdResponse?.room_id ?? '';

      // Use display name from Matrix profile, fall back to flag, then prompt
      let name = matrixLogin.displayName ?? flags.name;
      if (!name) {
        name = await p.text({
          message: 'Display name for this wallet:',
          placeholder: 'My Wallet',
          validate(value) {
            if (!value?.trim()) return 'Name is required';
            return undefined;
          },
        }) as string;

        if (p.isCancel(name)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
      } else {
        p.log.info(`Using display name: ${name}`);
      }

      // Build and save wallet
      this.wallet.setWallet({
        address: account.address,
        algo: 'secp',
        did: secpClient.did,
        network: network as NETWORK,
        matrix: {
          accessToken: matrixLogin.accessToken,
          userId: matrixLogin.userId,
          address: account.address,
          roomId,
        },
        name,
        pubKey: Buffer.from(account.pubkey).toString('hex'),
        ledgered: false,
        mode: 'offline',
        offlineConfig: {
          mnemonic,
          matrixPassword,
        },
      });

      return {
        success: true,
        data: {
          message: 'Successfully logged in with offline wallet!',
          wallet: {
            address: account.address,
            did: secpClient.did,
            name,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? `Offline login failed: ${error.message}` : 'Unknown error',
      };
    }
  }
}
