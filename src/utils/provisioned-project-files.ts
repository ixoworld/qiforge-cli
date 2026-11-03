import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import fs from 'fs';
import path from 'path';
import {
  COMPOSIO_BASE_URL,
  createComposioApiKey,
  edMnemonicExists,
  fetchOrCreateEdMnemonic,
  resolveEdPinDecision,
} from './composio';
import {
  buildCredentialsFile,
  buildDevVars,
  CREDENTIALS_FILENAME,
  DEV_VARS_FILENAME,
  type OracleIdentityVars,
} from './oracle-project';
import { RuntimeConfig } from './runtime-config';
import { Wallet } from './wallet';

function writeSecretFile(filePath: string, content: string): void {
  // Owner-only: these files hold the oracle's mnemonics and Matrix password.
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  console.log('✅ written:', filePath);
}

/**
 * Writes the provisioned oracle's values into the scaffolded Workers project:
 *
 * - `wrangler.jsonc` / `wrangler.gateway.jsonc` are re-rendered with the
 *   oracle's identity (DIDs, Matrix user and account room) in `vars`;
 * - `.dev.vars` gets the Worker's secrets for `wrangler dev`;
 * - `oracle-credentials.env` gets the operator's full record (wallet
 *   mnemonic, signing mnemonic, Matrix credentials), read by other commands
 *   through `--env` and never by the Worker.
 *
 * It mints the oracle's Composio API key on the way (best effort). It does not
 * log the oracle's Matrix account in: the Workers gateway logs its own device
 * in with the password, and an extra CLI device would sit on the account
 * unused.
 */
export const writeProvisionedProjectFiles = async (
  config: RuntimeConfig,
  wallet: Wallet,
  renderWranglerConfigs: (identity: OracleIdentityVars) => void,
) => {
  const oracleMatrixHomeServerUrl = config.getOrThrow('oracleMatrixHomeServerUrl');
  const network = config.getOrThrow('network') as NETWORK;
  const regResult = config.getOrThrow('registerUserResult');

  const projectPath = config.getOrThrow('projectPath');
  const envDir = projectPath;

  console.log('Creating env files in:', envDir);

  if (!fs.existsSync(envDir)) {
    console.log('Creating directory:', envDir);
    fs.mkdirSync(envDir, { recursive: true });
  }

  const oracleName = (config.getValue('projectName') as string) ?? '';
  const entityDid = config.getOrThrow('entityDid');

  // Mint a Composio API key for the oracle. This is delegated by the *user's*
  // wallet identity (not the oracle's): the ED signing mnemonic lives in the
  // user's Matrix room and the on-chain verification method is added to the
  // user's IID, signed by the user's wallet. Using the oracle's account here
  // would fail because the oracle cannot modify the user's IID document.
  let composioApiKey = '';
  try {
    console.log('🔑 Setting up Composio API key...');

    const userMatrixHomeServer = wallet.matrixHomeServer;
    const userMatrix = wallet.matrix;
    if (!userMatrixHomeServer || !userMatrix?.roomId || !wallet.address || !wallet.did) {
      throw new Error('User wallet Matrix credentials are incomplete');
    }

    // Use a fresh user Matrix token (offline wallets re-login) so a stale
    // stored token doesn't break the room-state read/write below.
    const userMatrixAccessToken = await wallet.getFreshMatrixAccessToken();

    const blobExists = await edMnemonicExists({
      matrixHomeServerUrl: userMatrixHomeServer,
      matrixAccessToken: userMatrixAccessToken,
      matrixRoomId: userMatrix.roomId,
    });

    const decision = resolveEdPinDecision({
      storedPin: wallet.edKeyPin,
      blobExists,
    });

    let edPin: string;
    let persistPin = false;
    if ('pin' in decision) {
      edPin = decision.pin;
    } else if ('useOraclePin' in decision) {
      edPin = regResult.pin;
      persistPin = true;
    } else {
      const entered = await p.password({
        message: 'PIN that unlocks your Composio signing key (from your first project):',
      });
      if (p.isCancel(entered)) {
        throw new Error('Composio signing-key PIN entry cancelled');
      }
      edPin = String(entered);
      persistPin = true;
    }

    const edMnemonic = await fetchOrCreateEdMnemonic({
      matrixHomeServerUrl: userMatrixHomeServer,
      matrixAccessToken: userMatrixAccessToken,
      matrixRoomId: userMatrix.roomId,
      pin: edPin,
    });

    if (persistPin) wallet.persistEdKeyPin(edPin);

    composioApiKey = await createComposioApiKey({
      userDid: wallet.did,
      oracleDid: regResult.did,
      address: wallet.address,
      edMnemonic,
      network,
      label: oracleName,
      signAndBroadcast: (msgs, memo) => wallet.signAndBroadcast(msgs, memo),
    });
    console.log('✅ Composio API key created');
    console.log(`💡 Manage your Composio API keys at ${COMPOSIO_BASE_URL}`);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const reason = /decrypt/i.test(message)
      ? 'wrong PIN for your Composio signing key'
      : /subscription|402/i.test(message)
        ? 'no active subscription for this network'
        : message;
    console.warn('⚠  Composio API key not created');
    console.warn(`   reason: ${reason}`);
    console.warn('   fix:    qiforge-cli create-composio-key');
    console.warn('   (everything else in your project is set up)');
  }

  renderWranglerConfigs({
    oracleDid: regResult.did,
    entityDid,
    matrixBaseUrl: oracleMatrixHomeServerUrl,
    matrixUserId: regResult.matrixUserId,
    matrixRoomId: regResult.matrixRoomId,
  });
  console.log('✅ wrangler.jsonc and wrangler.gateway.jsonc filled in with the oracle identity');

  writeSecretFile(
    path.join(envDir, DEV_VARS_FILENAME),
    buildDevVars({
      matrixPassword: regResult.matrixPassword,
      matrixRecoveryPhrase: regResult.matrixRecoveryPhrase,
      matrixPin: regResult.pin,
      ...(composioApiKey ? { composioApiKey } : {}),
    }),
  );

  writeSecretFile(
    path.join(envDir, CREDENTIALS_FILENAME),
    buildCredentialsFile({
      network,
      oracleAddress: regResult.address,
      oracleDid: regResult.did,
      entityDid,
      secpMnemonic: regResult.mnemonic,
      signingMnemonic: regResult.signingMnemonic,
      matrixBaseUrl: oracleMatrixHomeServerUrl,
      matrixUserId: regResult.matrixUserId,
      matrixPassword: regResult.matrixPassword,
      matrixRoomId: regResult.matrixRoomId,
      matrixPin: regResult.pin,
      matrixRecoveryPhrase: regResult.matrixRecoveryPhrase,
      matrixMnemonic: regResult.matrixMnemonic,
    }),
  );
};
