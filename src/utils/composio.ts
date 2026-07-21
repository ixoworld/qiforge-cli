import { Ed25519, sha256 } from '@cosmjs/crypto';
import { toHex, toUtf8 } from '@cosmjs/encoding';
import { EncodeObject } from '@cosmjs/proto-signing';
import { createQueryClient, customMessages, ixo, utils } from '@ixo/impactxclient-sdk';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import base58 from 'bs58';
import { createDecipheriv } from 'crypto';
import { encrypt } from './account/utils';
import { CHAIN_RPC } from './common';

export type SignAndBroadcastFn = (msgs: readonly EncodeObject[], memo: string) => Promise<unknown>;

export const COMPOSIO_BASE_URL = 'https://composio.ixo.earth';

const DELEGATION_TTL_SEC = 7 * 24 * 60 * 60;
const ED_SIGNING_STATE_KEY = 'encrypted_mnemonic_ed_signing';

function decrypt(ciphertext: string, pin: string): string {
  const [ivHex, encHex] = ciphertext.split(':');
  if (!ivHex || !encHex) throw new Error('Malformed ciphertext');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const key = Buffer.from(pin.padEnd(32));
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(encrypted);
  dec = Buffer.concat([dec, decipher.final()]);
  return dec.toString('utf8');
}

export async function fetchOrCreateEdMnemonic(
  {
    matrixHomeServerUrl,
    matrixAccessToken,
    matrixRoomId,
    pin,
  }: {
    matrixHomeServerUrl: string;
    matrixAccessToken: string;
    matrixRoomId: string;
    pin: string;
  },
  options: { allowCreate?: boolean } = {},
): Promise<string> {
  const { allowCreate = true } = options;
  const stateUrl = `${matrixHomeServerUrl}/_matrix/client/v3/rooms/${encodeURIComponent(
    matrixRoomId
  )}/state/ixo.room.state.secure/${ED_SIGNING_STATE_KEY}`;

  const res = await fetch(stateUrl, {
    headers: { Authorization: `Bearer ${matrixAccessToken}` },
  });

  if (res.ok) {
    const data = (await res.json()) as { encrypted_mnemonic?: string };
    if (data.encrypted_mnemonic) {
      try {
        return decrypt(data.encrypted_mnemonic, pin);
      } catch {
        throw new Error('Failed to decrypt ED signing mnemonic — wrong PIN?');
      }
    }
  } else if (res.status !== 404) {
    // Only 404 (state event not set) means "create a new one". Any other
    // status (401, 403, 5xx, …) is an unrelated error; falling through
    // would overwrite an existing mnemonic the user can't currently reach.
    throw new Error(`Failed to read ED signing mnemonic from Matrix (${res.status})`);
  }

  // Not found — generate and store a new one (unless the caller needs the
  // runtime-provisioned key and a fresh one would be useless, e.g. dashboard-access)
  if (!allowCreate) {
    throw new Error(
      "No claim-signing key found in this oracle's Matrix room — run the oracle once (pnpm dev) so the runtime provisions it, then retry.",
    );
  }
  const edMnemonic = utils.mnemonic.generateMnemonic(12);
  const stored = await fetch(stateUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${matrixAccessToken}`,
    },
    body: JSON.stringify({ encrypted_mnemonic: encrypt(edMnemonic, pin) }),
  });

  if (!stored.ok) {
    throw new Error(`Failed to store ED signing mnemonic in Matrix: ${stored.status}`);
  }

  return edMnemonic;
}

async function ensureEdVerificationOnChain({
  userDid,
  address,
  edMnemonic,
  network,
  signAndBroadcast,
}: {
  userDid: string;
  address: string;
  edMnemonic: string;
  network: NETWORK;
  signAndBroadcast: SignAndBroadcastFn;
}): Promise<void> {
  const keypair = await Ed25519.makeKeypair(sha256(toUtf8(edMnemonic)).slice(0, 32));
  const pubkeyBytes = keypair.pubkey;
  const pubKeyHex = toHex(pubkeyBytes);

  const queryClient = await createQueryClient(CHAIN_RPC[network]);
  const iidRes = await queryClient.ixo.iid.v1beta1.iidDocument({ id: userDid });
  const vms = iidRes?.iidDocument?.verificationMethod ?? [];

  // Ed25519 keys are stored as publicKeyBase58 on-chain; decode to hex for comparison.
  const alreadyRegistered = vms.some((vm) => {
    if (!vm.publicKeyBase58) return false;
    return toHex(base58.decode(vm.publicKeyBase58)) === pubKeyHex;
  });
  if (alreadyRegistered) return;

  const msg = {
    typeUrl: '/ixo.iid.v1beta1.MsgAddVerification',
    value: ixo.iid.v1beta1.MsgAddVerification.fromPartial({
      id: userDid,
      verification: ixo.iid.v1beta1.Verification.fromPartial({
        relationships: ['authentication', 'assertionMethod'],
        method: customMessages.iid.createVerificationMethod(userDid, pubkeyBytes, userDid, 'ed'),
      }),
      signer: address,
    }),
  };

  await signAndBroadcast([msg], 'Add Ed25519 verification method for UCAN signing');
}

export async function createComposioApiKey({
  userDid,
  oracleDid,
  address,
  edMnemonic,
  network,
  label,
  signAndBroadcast,
}: {
  userDid: string;
  oracleDid: string;
  address: string;
  edMnemonic: string;
  network: NETWORK;
  label: string;
  signAndBroadcast: SignAndBroadcastFn;
}): Promise<string> {
  const { ed25519, createDelegation, serializeDelegation } = await import('@ixo/ucan');

  // Ensure the Ed25519 key is registered on-chain so the worker can validate the delegation
  await ensureEdVerificationOnChain({ userDid, address, edMnemonic, network, signAndBroadcast });

  // Derive signer wrapped with the oracle's DID
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(edMnemonic.trim()));
  const seed = new Uint8Array(hashBuf).slice(0, 32);
  const signer = (await ed25519.Signer.derive(seed)).withDID(userDid as `did:${string}:${string}`);

  // Resolve the worker's DID
  const workerDidRes = await fetch(`${COMPOSIO_BASE_URL}/.well-known/did.json`);
  if (!workerDidRes.ok) throw new Error('Failed to resolve composio worker DID');
  const workerDid = ((await workerDidRes.json()) as { id: string }).id;

  // Mint a 7-day delegation
  const expiration = Math.floor(Date.now() / 1000) + DELEGATION_TTL_SEC;
  const delegation = await createDelegation({
    issuer: signer,
    audience: workerDid,
    capabilities: [
      { can: 'api-key/*', with: 'ixo:composio:api-keys' },
      { can: 'subscriptions/read', with: 'ixo:subscriptions' },
    ],
    expiration,
  });
  const serialized = await serializeDelegation(delegation);

  // Create the API key
  const res = await fetch(`${COMPOSIO_BASE_URL}/v1/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-UCAN-Delegation': serialized,
      'X-IXO-Network': network,
    },
    body: JSON.stringify({ label, oracleDid: oracleDid }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Composio key creation failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const data = (await res.json()) as { apiKey?: string };
  if (!data.apiKey) throw new Error('Composio API returned no key');
  return data.apiKey;
}
