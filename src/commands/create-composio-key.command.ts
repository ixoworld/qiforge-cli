import * as p from '@clack/prompts';
import { Command } from '.';
import { CLIResult } from '../types';
import { COMPOSIO_BASE_URL, createComposioApiKey, fetchOrCreateEdMnemonic } from '../utils/composio';
import { Wallet } from '../utils/wallet';

export class CreateComposioKeyCommand implements Command {
  name = 'create-composio-key';
  description = 'Create a Composio API key for this oracle';

  constructor(private readonly wallet: Wallet) {}

  async execute(): Promise<CLIResult> {
    const w = this.wallet.wallet;
    if (!w) return { success: false, error: 'Wallet not loaded' };

    // Prompt for required inputs
    const oracleDid = await p.text({
      message: 'Oracle  DID',
      placeholder: 'did:ixo:...',
      validate: (v) => (!v ? 'Required' : undefined),
    });
    if (p.isCancel(oracleDid)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }

    const label = await p.text({
      message: 'Key label',
      placeholder: 'my-oracle',
      validate: (v) => (!v ? 'Required' : undefined),
    });
    if (p.isCancel(label)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }

    const pin = await p.password({
      message: 'Signing PIN (used to decrypt / create your ED signing mnemonic)',
      validate: (v) => (!v ? 'Required' : undefined),
    });
    if (p.isCancel(pin)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }

    const matrixHomeServer = this.wallet.matrixHomeServer;
    if (!matrixHomeServer) {
      return { success: false, error: 'Cannot derive Matrix homeserver from wallet' };
    }
    const matrixRoomId = w.matrix?.roomId;
    if (!matrixRoomId) {
      return { success: false, error: 'Matrix credentials missing from wallet' };
    }
    if (!w.address) {
      return { success: false, error: 'Wallet address missing' };
    }

    const s = p.spinner();

    try {
      // Get a fresh Matrix access token (offline wallets re-login) so a stale
      // stored token doesn't break the room-state read/write below.
      const matrixAccessToken = await this.wallet.getFreshMatrixAccessToken();

      s.start('Fetching / creating ED signing mnemonic...');
      const edMnemonic = await fetchOrCreateEdMnemonic({
        matrixHomeServerUrl: matrixHomeServer,
        matrixAccessToken,
        matrixRoomId,
        pin: String(pin),
      });
      s.stop('ED signing mnemonic ready');

      s.start('Creating Composio API key...');
      const apiKey = await createComposioApiKey({
        userDid: w.did,
        oracleDid: String(oracleDid),
        address: w.address,
        edMnemonic,
        network: w.network,
        label: String(label),
        signAndBroadcast: (msgs, memo) => this.wallet.signAndBroadcast(msgs, memo),
      });
      s.stop('Composio API key created');

      p.log.success(`API key: ${apiKey}`);
      p.log.info(`Manage your Composio API keys at ${COMPOSIO_BASE_URL}`);

      return { success: true, data: { apiKey, label: String(label) } };
    } catch (err) {
      s.stop('Failed');
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
