/**
 * Provisioning of the oracle's Ed25519 UCAN signing key (see `signing-key.ts`
 * for why the Workers runtime needs it): the PIN-encrypted mnemonic in the
 * oracle's Matrix account room, and the public key as a verification method
 * on the oracle's DID document.
 *
 * The Node runtime used to do both on its first boot; the Workers runtime
 * only reads them, so the CLI provisions them.
 */
import { EncodeObject, OfflineSigner } from '@cosmjs/proto-signing';
import { createQueryClient, customMessages, ixo } from '@ixo/impactxclient-sdk';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import base58 from 'bs58';
import { CHAIN_RPC } from '../common';
import {
  SIGNING_MNEMONIC_STATE_KEY,
  SIGNING_MNEMONIC_STATE_TYPE,
  signingPublicKeyFromMnemonic,
} from './signing-key';
import { encrypt, signAndBroadcastWithMnemonic } from './utils';

/**
 * Relationships of the signing key's verification method. The UCAN DID
 * resolver reads every verification method regardless of relationship;
 * `authentication` + `assertionMethod` match the Ed25519 key the CLI already
 * registers for users (Composio delegations).
 */
const SIGNING_KEY_RELATIONSHIPS = ['authentication', 'assertionMethod'];

/** The `Verification` that puts the signing key on `did`'s document. */
export function buildSigningKeyVerification(did: string, publicKey: Uint8Array) {
  return ixo.iid.v1beta1.Verification.fromPartial({
    relationships: SIGNING_KEY_RELATIONSHIPS,
    method: customMessages.iid.createVerificationMethod(did, publicKey, did, 'ed'),
  });
}

/** `MsgAddVerification` for a DID document that already exists. */
export function buildAddSigningKeyMsg(params: {
  did: string;
  publicKey: Uint8Array;
  signerAddress: string;
}): EncodeObject {
  return {
    typeUrl: '/ixo.iid.v1beta1.MsgAddVerification',
    value: ixo.iid.v1beta1.MsgAddVerification.fromPartial({
      id: params.did,
      verification: buildSigningKeyVerification(params.did, params.publicKey),
      signer: params.signerAddress,
    }),
  };
}

/** Whether `did`'s on-chain document already carries this Ed25519 public key. */
export async function didHasSigningKey(did: string, publicKey: Uint8Array, network: NETWORK): Promise<boolean> {
  const queryClient = await createQueryClient(CHAIN_RPC[network]);
  const response = await queryClient.ixo.iid.v1beta1.iidDocument({ id: did });
  const target = Buffer.from(publicKey).toString('hex');
  return (response?.iidDocument?.verificationMethod ?? []).some((method) => {
    if (!method.publicKeyBase58) return false;
    try {
      return Buffer.from(base58.decode(method.publicKeyBase58)).toString('hex') === target;
    } catch {
      return false;
    }
  });
}

/**
 * Adds the signing key to the oracle's DID document when it is not there yet,
 * signed by the oracle's own account (the DID's controller).
 */
export async function ensureSigningKeyOnChain(params: {
  did: string;
  signingMnemonic: string;
  oracleSigner: OfflineSigner;
  network: NETWORK;
  feegrantGranter?: string;
}): Promise<'added' | 'present'> {
  const publicKey = signingPublicKeyFromMnemonic(params.signingMnemonic);
  if (await didHasSigningKey(params.did, publicKey, params.network)) return 'present';
  const [account] = await params.oracleSigner.getAccounts();
  if (!account) throw new Error('The oracle signer has no account');
  await signAndBroadcastWithMnemonic({
    offlineSigner: params.oracleSigner,
    messages: [buildAddSigningKeyMsg({ did: params.did, publicKey, signerAddress: account.address })],
    memo: 'Add Ed25519 verification method for UCAN signing',
    ...(params.feegrantGranter ? { feegrantGranter: params.feegrantGranter } : {}),
    network: params.network,
  });
  if (!(await didHasSigningKey(params.did, publicKey, params.network))) {
    throw new Error(`The signing key was broadcast but is not on ${params.did}'s document`);
  }
  return 'added';
}

function signingStateUrl(homeServerUrl: string, roomId: string): string {
  return `${homeServerUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${SIGNING_MNEMONIC_STATE_TYPE}/${SIGNING_MNEMONIC_STATE_KEY}`;
}

/**
 * Stores the signing mnemonic in the oracle's account room, AES-256-CBC
 * encrypted with the PIN (`MATRIX_VALUE_PIN`) — the format the runtime reads.
 */
export async function storeSigningMnemonic(params: {
  homeServerUrl: string;
  accessToken: string;
  roomId: string;
  mnemonic: string;
  pin: string;
}): Promise<void> {
  const res = await fetch(signingStateUrl(params.homeServerUrl, params.roomId), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({ encrypted_mnemonic: encrypt(params.mnemonic, params.pin) }),
  });
  if (!res.ok) {
    throw new Error(`Failed to store the signing mnemonic in the account room (${res.status})`);
  }
}
