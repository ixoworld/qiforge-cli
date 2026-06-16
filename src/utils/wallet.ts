import { log } from '@clack/prompts';
import { EncodeObject } from '@cosmjs/proto-signing';
import { cosmos } from '@ixo/impactxclient-sdk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { generateUsernameFromAddress, mxLoginRaw } from './account/matrix';
import { getSecpClient, signAndBroadcastWithMnemonic } from './account/utils';
import { RuntimeConfig } from './runtime-config';
import { SignXClient } from './signx/signx';
import { WalletProps } from './signx/types';

// Use hidden .wallet.json file in user's home directory
const WALLET_PATH = path.join(os.homedir(), '.wallet.json');

// for dev make it here
// const WALLET_PATH = path.join(__dirname, '.wallet.json');

export class Wallet {
  public wallet: WalletProps | undefined;
  public signXClient?: SignXClient;
  private config: RuntimeConfig;
  constructor(config: RuntimeConfig) {
    this.config = config;
    this.loadWallet();
  }

  public setSignXClient(signXClient: SignXClient) {
    this.signXClient = signXClient;
  }

  private loadWallet() {
    if (existsSync(WALLET_PATH)) {
      try {
        const walletData = readFileSync(WALLET_PATH, 'utf8');
        this.wallet = JSON.parse(walletData) as WalletProps;

        // Validate that matrix userId is present — required for homeserver derivation
        if (!this.wallet.matrix?.userId || !this.wallet.matrix.userId.includes(':')) {
          log.warning('Wallet is missing valid Matrix credentials. Please re-authenticate via SignX.');
          this.wallet = undefined;
          return;
        }

        // Use wallet.network directly from WalletProps (provided by SignX)
        let network = this.wallet.network;

        // Fallback: derive network from matrix domain for wallets saved before network field was added
        if (!network) {
          const mxDomain = this.wallet.matrix.userId.split(':')[1];
          const mxDomainToNetwork = {
            'devmx.ixo.earth': 'devnet',
            'testmx.ixo.earth': 'testnet',
            'mx.ixo.earth': 'mainnet',
          } as const;
          network = mxDomainToNetwork[mxDomain as keyof typeof mxDomainToNetwork];
          if (!network) {
            throw new Error(`Cannot determine network from matrix domain: ${mxDomain}`);
          }
          this.wallet.network = network;
        }

        this.config.addValue('network', network);

        if (this.wallet.mode === 'offline') {
          log.success(`Welcome back, ${this.wallet.name}! (offline mode)`);
        } else {
          this.setSignXClient(new SignXClient(network));
          log.success(`Welcome back, ${this.wallet.name}!`);
        }
        log.info(`Network: ${network}`);
      } catch (error) {
        log.warning(`Failed to load wallet file: ${error instanceof Error ? error.message : String(error)}`);
        this.wallet = undefined;
      }
    } else {
      log.warning('No wallet file found');
    }
  }

  setWallet(wallet: WalletProps) {
    try {
      this.wallet = wallet;

      const walletJson = JSON.stringify(wallet, null, 2);
      writeFileSync(WALLET_PATH, walletJson, 'utf8');
      log.success(`Wallet saved successfully to: ${WALLET_PATH}`);
    } catch (error) {
      log.error(`Failed to save wallet: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error('Failed to save wallet file');
    }
  }

  public checkWalletExists() {
    return existsSync(WALLET_PATH) && this.wallet !== undefined;
  }

  public async clearWallet() {
    this.wallet = undefined;
    try {
      if (existsSync(WALLET_PATH)) {
        await unlink(WALLET_PATH);
        log.success('Wallet file deleted successfully');
      }
    } catch (error) {
      log.error(`Failed to delete wallet file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  get did() {
    return this.wallet?.did;
  }

  get address() {
    return this.wallet?.address;
  }

  get name() {
    return this.wallet?.name;
  }

  get pubKey() {
    return this.wallet?.pubKey;
  }

  get algo() {
    return this.wallet?.algo;
  }

  get matrix() {
    return this.wallet?.matrix;
  }

  /**
   * Extracts the Matrix homeserver URL from the user's matrix userId.
   * e.g. @user:devmx.ixo.earth → https://devmx.ixo.earth
   */
  get matrixHomeServer(): string | undefined {
    const userId = this.wallet?.matrix?.userId;
    if (!userId || !userId.includes(':')) return undefined;
    const domain = userId.split(':')[1];
    return `https://${domain}`;
  }

  public reloadWallet() {
    this.loadWallet();
  }

  /**
   * Returns a Matrix access token for the user's wallet account, refreshing it
   * when possible. Offline wallets persist the Matrix password, so we re-login
   * to obtain a fresh token (the stored one may have gone stale). SignX wallets
   * have no stored password to re-login with, so the existing session token is
   * returned. Used when acting as the user's Matrix account (e.g. minting a
   * Composio API key) so we don't fail on an expired token.
   */
  async getFreshMatrixAccessToken(): Promise<string> {
    const matrix = this.wallet?.matrix;
    if (!matrix?.accessToken) {
      throw new Error('Matrix credentials missing from wallet');
    }

    const homeServerUrl = this.matrixHomeServer;
    const password = this.wallet?.offlineConfig?.matrixPassword;
    if (this.wallet?.mode === 'offline' && homeServerUrl && password && this.wallet.address) {
      try {
        const username = generateUsernameFromAddress(this.wallet.address);
        const login = await mxLoginRaw({ homeServerUrl, username, password });
        // Persist the refreshed token so subsequent operations reuse it.
        this.wallet.matrix.accessToken = login.accessToken;
        this.setWallet(this.wallet);
        return login.accessToken;
      } catch (error) {
        log.warning(
          `Could not refresh Matrix token, using existing session: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return matrix.accessToken;
  }

  /**
   * Unified sign-and-broadcast: delegates to SignX (QR scan) or offline (local mnemonic).
   */
  async signAndBroadcast(
    messages: readonly EncodeObject[],
    memo?: string,
  ) {
    if (!this.wallet) throw new Error('Wallet not loaded');

    if (this.wallet.mode === 'offline') {
      return this.offlineSignAndBroadcast(messages, memo);
    }
    return this.signxSignAndBroadcast(messages, memo);
  }

  private async signxSignAndBroadcast(
    messages: readonly EncodeObject[],
    _memo?: string,
  ) {
    if (!this.signXClient || !this.wallet) {
      throw new Error('SignX client or wallet not found');
    }
    const tx = await this.signXClient.transact([...messages], this.wallet);
    this.signXClient.displayTransactionQRCode(JSON.stringify(tx));
    await this.signXClient.pollNextTransaction();
    return await this.signXClient.awaitTransaction();
  }

  private async offlineSignAndBroadcast(
    messages: readonly EncodeObject[],
    memo?: string,
  ) {
    if (!this.wallet?.offlineConfig?.mnemonic) {
      throw new Error('Offline wallet mnemonic not found');
    }
    const offlineSigner = await getSecpClient(this.wallet.offlineConfig.mnemonic);
    return signAndBroadcastWithMnemonic({
      offlineSigner,
      messages: [...messages],
      memo: memo ?? '',
      feegrantGranter: '',
      network: this.wallet.network,
    });
  }

  async sendTokens(address: string, amount: number) {
    if (!this.address || !this.wallet) {
      throw new Error('Wallet not loaded');
    }
    const sendTokensToUserMsg = {
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: cosmos.bank.v1beta1.MsgSend.fromPartial({
        fromAddress: this.address,
        toAddress: address,
        amount: [
          cosmos.base.v1beta1.Coin.fromPartial({
            amount: amount.toString(),
            denom: 'uixo',
          }),
        ],
      }),
    };
    return this.signAndBroadcast([sendTokensToUserMsg]);
  }
}
