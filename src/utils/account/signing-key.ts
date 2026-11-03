/**
 * The oracle's Ed25519 UCAN signing key — pure derivation, Node built-ins
 * only, so unit tests can import it under ts-jest.
 *
 * The Workers runtime signs every downstream UCAN invocation (owner copy in
 * the VFS, memory engine, sandbox, …) with an Ed25519 key derived from a
 * mnemonic: `ORACLE_SIGNING_MNEMONIC`, or the copy kept PIN-encrypted in the
 * oracle's Matrix account room. The receiving service resolves the oracle's
 * `did:ixo` document through Blocksync and accepts only Ed25519 verification
 * methods (32-byte keys); the secp256k1 methods every IXO account carries are
 * skipped. So the key's public half must be on the oracle's DID document.
 *
 * Derivation (the contract of `@ixo/ucan`'s `signerFromMnemonic`, pinned by
 * its golden vectors): seed = SHA-256(UTF-8(mnemonic.trim()))[0..32), and the
 * Ed25519 keypair from that seed.
 */
import { createHash, createPrivateKey, createPublicKey } from 'crypto';

/** Matrix room state the Node runtime and the Workers runtime read the mnemonic from. */
export const SIGNING_MNEMONIC_STATE_TYPE = 'ixo.room.state.secure';
export const SIGNING_MNEMONIC_STATE_KEY = 'encrypted_mnemonic_ed_signing';

/** DER prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The 32-byte Ed25519 seed of a signing mnemonic. */
export function signingSeedFromMnemonic(mnemonic: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(mnemonic.trim(), 'utf8').digest()).slice(0, 32);
}

/** The raw 32-byte Ed25519 public key of a signing mnemonic. */
export function signingPublicKeyFromMnemonic(mnemonic: string): Uint8Array {
  const seed = signingSeedFromMnemonic(mnemonic);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  // SPKI for Ed25519 is a 12-byte header followed by the raw 32-byte key.
  return new Uint8Array(spki.subarray(spki.length - 32));
}
