import { Bip39, EnglishMnemonic, Secp256k1, sha256, Slip10, Slip10Curve, stringToPath } from '@cosmjs/crypto';
import { AccountData, DirectSecp256k1HdWallet, OfflineSigner } from '@cosmjs/proto-signing';
import type { DeliverTxResponse } from '@cosmjs/stargate';
import { createQueryClient, createSigningClient, customMessages, ixo, utils } from '@ixo/impactxclient-sdk';
import { Verification } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/tx';
import { Service } from '@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { createCipheriv, randomBytes } from 'crypto';
import { CHAIN_RPC } from '../common';
import { decodeGrants, isAllowanceExpired, isAllowanceLimitReached } from './feegrant';
/**
 * Checks if an iid document (did) exists
 * @param did - The did to check for
 * @returns True if the iid document exists, false otherwise
 */
export async function checkIidDocumentExists(did: string, network: NETWORK) {
  if (!network) {
    throw new Error('Network parameter is required but was undefined');
  }

  console.log(`🔍 Checking IID document for DID: ${did} on network: ${network}`);

  const url = CHAIN_RPC[network];
  if (!url) {
    throw new Error(`Invalid network: ${network}. Valid networks are: ${Object.keys(CHAIN_RPC).join(', ')}`);
  }

  console.log(`🔗 Using RPC URL: ${url}`);

  try {
    const queryClient = await createQueryClient(url);
    const iidDocumentResponse = await queryClient.ixo.iid.v1beta1.iidDocument({ id: did });
    if (!iidDocumentResponse?.iidDocument?.id) {
      return false;
    }
    return true;
  } catch (error) {
    if ((error as Error).message?.includes('did document not found') || (error as Error).message?.includes('(22)')) {
      return false;
    }
    console.error('Error checking IID document:', error);
    throw error;
  }
}

/**
 * Creates an iid document (did)
 * Must be signed by base account mnemonic (not passkey signer)
 * @param did - The did to create iid document for
 * @param offlineSigner - The offline signer to use to create iid document
 * @param services - Services to put on the document
 * @param extraVerifications - Verification methods besides the signer's own
 *   secp256k1 set (e.g. the oracle's Ed25519 UCAN signing key)
 */
export async function createIidDocument(
  did: string,
  network: NETWORK,
  offlineSigner: OfflineSigner,
  services?: Service[],
  extraVerifications: Verification[] = []
) {
  try {
    const accounts = await offlineSigner.getAccounts();
    const { address, pubkey } = (accounts[0] ?? {}) as AccountData;
    const allowances = await queryAddressAllowances(address, network);
    const feegrantGranter = allowances?.length
      ? decodeGrants(allowances)?.find(
          (allowance) =>
            !!allowance &&
            !isAllowanceExpired(allowance.expiration as number) &&
            !isAllowanceLimitReached(allowance.limit)
        )?.granter
      : undefined;
    const trx = {
      typeUrl: '/ixo.iid.v1beta1.MsgCreateIidDocument',
      value: ixo.iid.v1beta1.MsgCreateIidDocument.fromPartial({
        id: did,
        verifications: [
          ...customMessages.iid.createIidVerificationMethods({
            did: did,
            pubkey: pubkey,
            address: address,
            controller: did,
            type: 'secp',
          }),
          ...extraVerifications,
        ],
        signer: address,
        controllers: [did],
        ...(services?.length ? { services: services } : {}),
      }),
    };
    // if (!feegrantGranter) {
    //   throw new Error('No feegrant granter found');
    // }
    await signAndBroadcastWithMnemonic({
      offlineSigner: offlineSigner,
      messages: [trx],
      feegrantGranter: feegrantGranter as string,
      network,
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function queryAddressAllowances(address: string, network: NETWORK) {
  try {
    const url = CHAIN_RPC[network];
    if (!url) {
      throw new Error(`Invalid network: ${network}`);
    }
    const queryClient = await createQueryClient(url);
    const allowancesResponse = await queryClient.cosmos.feegrant.v1beta1.allowances({
      grantee: address,
    });
    return allowancesResponse?.allowances ?? [];
  } catch (error) {
    console.error('queryAddressAllowances::', (error as Error).message);
    return undefined;
  }
}

/**
 * Signs and broadcasts a transaction with a mnemonic
 * @param offlineSigner - The offline signer
 * @param messages - The messages to sign and broadcast
 * @param memo - The memo for the transaction
 * @param feegrantGranter - The granter for the transaction
 * @returns The deliver tx response
 */
export const signAndBroadcastWithMnemonic = async ({
  offlineSigner,
  messages,
  memo = 'Signing with Mnemonic Demo',
  feegrantGranter,
  network,
}: {
  offlineSigner: OfflineSigner;
  messages: any[];
  memo?: string;
  feegrantGranter?: string;
  network: NETWORK;
}): Promise<DeliverTxResponse> => {
  const url = CHAIN_RPC[network];
  if (!url) {
    throw new Error(`Invalid network: ${network}`);
  }
  const signingClient = await createSigningClient(url, offlineSigner);
  const accounts = await offlineSigner.getAccounts();
  const { address } = (accounts[0] ?? {}) as AccountData;

  const simGas = await signingClient.simulate(address, messages, memo);
  const gasUsed = simGas > 50000 ? simGas : (messages ?? []).length * 500000;
  const gas = gasUsed * 1.7;
  const gasOptions = calculateTrxGasOptions(gas);
  const fee = {
    amount: [
      {
        denom: 'uixo',
        amount: String(Math.round(gasOptions.average)),
      },
    ],
    gas: String(Math.round(gas)),
    granter: feegrantGranter,
  };
  const result = await signingClient.signAndBroadcast(address, messages, fee as any, memo, undefined);
  const isDeliverTxFailure = !!result.code;
  if (isDeliverTxFailure) {
    throw new Error(
      `Error when broadcasting tx ${result.transactionHash} at height ${result.height}. Code: ${result.code}; Raw log: ${result.rawLog}`
    );
  }
  return result;
};

const calculateTrxGasOptions = (gasUsed: number) => {
  const gasPriceStep = {
    low: 0.02,
    average: 0.035,
    high: 0.045,
  };
  const gas = gasUsed < 0.01 ? 0.01 : gasUsed;
  const gasOptions = {
    low: gas * gasPriceStep.low,
    average: gas * gasPriceStep.average,
    high: gas * gasPriceStep.high,
  };

  return gasOptions;
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function encrypt(text: string, password: string) {
  const iv = randomBytes(16);

  const cipher = createCipheriv('aes-256-cbc', Buffer.from(password.padEnd(32)), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export type SecpClient = Awaited<ReturnType<typeof getSecpClient>>;
export const getSecpClient = async (mnemonic: string) => {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'ixo',
  });
  const account = (await wallet.getAccounts())[0];

  // Debug: Derive and verify keys manually for comparison
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const hdPath = stringToPath("m/44'/118'/0'/0/0");
  const slip10Result = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath);
  const privkey = slip10Result.privkey;
  // Derive the compressed public key from the private key
  const keypair = await Secp256k1.makeKeypair(privkey);
  const compressedPubkey = Secp256k1.compressPubkey(keypair.pubkey);
  // Log keys and addresses for comparison
  // console.log({
  //   walletPubkey: account!.pubkey ? Buffer.from(account!.pubkey).toString('hex') : 'not available',
  //   derivedPubkey: Buffer.from(compressedPubkey).toString('hex'),
  // });

  const secpClient = {
    mnemonic,
    did: utils.did.generateSecpDid(account!.address),
    baseAccount: account!,

    async getAccounts() {
      return (await wallet.getAccounts()) as AccountData[];
    },

    async signDirect(signerAddress: any, signDoc: any) {
      return await wallet.signDirect(signerAddress, signDoc);
    },

    /**
     * Sign a message with the secp256k1 private key derived from the mnemonic
     * @param message - The message to sign (usually a challenge string - base64 encoded)
     * @returns The signature as a Uint8Array
     */
    async sign(message: string): Promise<Uint8Array> {
      // Use the wallet's signDirect method to ensure consistent signing
      try {
        // Derive keypair from mnemonic directly
        const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));

        // NOTE: need to do checking here if it produces matched address to signed in one, maybe user is using a different derivation path
        // Use the standard Cosmos HD path (m/44'/118'/0'/0/0)
        const hdPath = stringToPath("m/44'/118'/0'/0/0");

        // Derive the private key using SLIP-10
        const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, hdPath);

        // For the challenge (base64 encoded string), decode to get the original bytes
        const challengeBytes = new Uint8Array(Buffer.from(message, 'base64'));

        // Hash the challenge bytes using SHA-256
        const messageHash = sha256(challengeBytes);

        // Sign the hash with the derived private key
        const signature = await Secp256k1.createSignature(messageHash, privkey);

        // Get the fixed-length signature, which is r (32 bytes) | s (32 bytes) | recovery param (1 byte)
        const fixedLengthSignature = signature.toFixedLength();

        // Remove the recovery parameter byte (last byte) to get only r and s
        // This gives us exactly 64 bytes which is what the verification expects
        return fixedLengthSignature.slice(0, 64);
      } catch (error) {
        console.error('Error during signature creation:', error);
        throw error;
      }
    },
  };

  return secpClient;
};
