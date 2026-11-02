import { signingPublicKeyFromMnemonic, signingSeedFromMnemonic } from '../utils/account/signing-key';

/**
 * Golden vectors of `@ixo/ucan`'s `signerFromMnemonic` (packages/ucan,
 * create-client.test.ts in the qiforge repo): the derivation the Workers
 * runtime signs UCANs with. privateKey = 'M' + base64pad(
 * [0x80,0x26] + seed(32) + [0xed,0x01] + publicKey(32)). If the CLI derived a
 * different key, the verification method it puts on the oracle's DID would
 * never match the runtime's signatures.
 */
const GOLDEN_VECTORS = [
  {
    mnemonic: 'test walk nut penalty hip pave soap entry language right filter choice',
    privateKey: 'MgCbkMwR9mL9STR39eTw2NNIOxsuPaF/w2cwo2mFQvp/bpO0BB0ms3SLsNb7m0aquWmOcC6Xx8EQiDH6LraZ3897K4ug=',
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    privateKey: 'MgCbFV+7IeN/YUro/iAh8TzUPCcVVN6teVJw80UMg7DzvOO0Bk6XyYZhJMeDfXHQ0sW1GjvsZUwmNPK1PoVBrngUuf8c=',
  },
];

function decodeUcantoPrivateKey(privateKey: string): { seed: Buffer; publicKey: Buffer } {
  const bytes = Buffer.from(privateKey.slice(1), 'base64');
  expect(bytes.length).toBe(68);
  expect([...bytes.subarray(0, 2)]).toEqual([0x80, 0x26]);
  expect([...bytes.subarray(34, 36)]).toEqual([0xed, 0x01]);
  return { seed: bytes.subarray(2, 34), publicKey: bytes.subarray(36, 68) };
}

describe('oracle UCAN signing key derivation', () => {
  it.each(GOLDEN_VECTORS)('matches @ixo/ucan signerFromMnemonic for "$mnemonic"', ({ mnemonic, privateKey }) => {
    const expected = decodeUcantoPrivateKey(privateKey);
    expect(Buffer.from(signingSeedFromMnemonic(mnemonic)).equals(expected.seed)).toBe(true);
    expect(Buffer.from(signingPublicKeyFromMnemonic(mnemonic)).equals(expected.publicKey)).toBe(true);
  });

  it('trims the mnemonic like the runtime does', () => {
    const mnemonic = 'test walk nut penalty hip pave soap entry language right filter choice';
    expect(Buffer.from(signingPublicKeyFromMnemonic(`  ${mnemonic}\n`))).toEqual(
      Buffer.from(signingPublicKeyFromMnemonic(mnemonic)),
    );
  });
});
