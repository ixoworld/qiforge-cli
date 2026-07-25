import { NETWORK } from '@ixo/signx-sdk/types/types/transact';

export type WalletMode = 'signx' | 'offline';

export interface MatrixLoginProps {
  address: string;
  accessToken: string;
  roomId: string;
  userId: string;
}

export interface OfflineWalletConfig {
  mnemonic: string;
  /**
   * The user's Matrix password. Persisted for offline wallets only so the CLI
   * can re-login and obtain a fresh Matrix access token when needed (e.g. when
   * minting a Composio API key). Offline wallets already store the mnemonic in
   * plaintext, so this is consistent with that trust model.
   */
  matrixPassword?: string;
}

export interface WalletProps {
  address: string;
  algo: string;
  did: string;
  network: NETWORK;
  matrix: MatrixLoginProps;
  name: string;
  pubKey: string;
  ledgered: boolean;
  mode?: WalletMode;
  offlineConfig?: OfflineWalletConfig;
  /**
   * PIN that encrypts the user's ED signing mnemonic in their Matrix room (used
   * to mint Composio delegations). Distinct from any per-oracle vault PIN.
   * Persisted on first successful key provisioning so later projects don't
   * re-prompt or reuse the wrong PIN.
   */
  edKeyPin?: string;
}
