import { TokenCipher, TokenCipherError } from './token-cipher';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);
const AAD = TokenCipher.aad('int_1', 'accessToken');

describe('TokenCipher (AES-256-GCM, ADR-0005)', () => {
  const cipher = new TokenCipher(new Map([[1, k1]]), 1);

  it('round-trips and never contains the plaintext', () => {
    const enc = cipher.encrypt('ghu_secret_token', AAD);
    expect(enc).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(enc).not.toContain('ghu_secret_token');
    expect(cipher.decrypt(enc, AAD)).toBe('ghu_secret_token');
  });

  it('uses a fresh IV per encryption', () => {
    expect(cipher.encrypt('same', AAD)).not.toBe(cipher.encrypt('same', AAD));
  });

  it('detects tampering with the ciphertext, IV or tag', () => {
    const enc = cipher.encrypt('ghu_secret_token', AAD);
    const [v, iv, ct, tag] = enc.split('.') as [string, string, string, string];
    const flip = (s: string) => {
      const buf = Buffer.from(s, 'base64url');
      buf[0] = (buf[0] ?? 0) ^ 0xff;
      return buf.toString('base64url');
    };
    for (const tampered of [
      [v, iv, flip(ct), tag],
      [v, flip(iv), ct, tag],
      [v, iv, ct, flip(tag)],
    ]) {
      expect(() => cipher.decrypt(tampered.join('.'), AAD)).toThrow(TokenCipherError);
    }
  });

  it('binds ciphertexts to the integration and field via AAD', () => {
    const enc = cipher.encrypt('ghu_secret_token', AAD);
    expect(() => cipher.decrypt(enc, TokenCipher.aad('int_2', 'accessToken'))).toThrow(
      'Ciphertext failed authentication',
    );
    expect(() => cipher.decrypt(enc, TokenCipher.aad('int_1', 'refreshToken'))).toThrow(
      TokenCipherError,
    );
  });

  it('rejects unknown key versions and malformed input', () => {
    const enc = cipher.encrypt('x', AAD);
    expect(() => cipher.decrypt(enc.replace(/^v1/, 'v9'), AAD)).toThrow('Unknown key version 9');
    expect(() => cipher.decrypt('plaintext-token', AAD)).toThrow('Malformed ciphertext');
  });

  it('supports rotation: new writes use the active key, old values still decrypt', () => {
    const old = cipher.encrypt('old-token', AAD);
    const rotated = new TokenCipher(
      new Map([
        [1, k1],
        [2, k2],
      ]),
      2,
    );
    const fresh = rotated.encrypt('new-token', AAD);
    expect(TokenCipher.versionOf(fresh)).toBe(2);
    expect(rotated.decrypt(old, AAD)).toBe('old-token');
    expect(rotated.decrypt(fresh, AAD)).toBe('new-token');
    // After the old key is removed, values not yet re-encrypted fail loudly.
    const onlyNew = new TokenCipher(new Map([[2, k2]]), 2);
    expect(() => onlyNew.decrypt(old, AAD)).toThrow('Unknown key version 1');
  });

  it('refuses a missing active key or wrong-length keys', () => {
    expect(() => new TokenCipher(new Map([[1, k1]]), 2)).toThrow(TokenCipherError);
    expect(() => new TokenCipher(new Map([[1, Buffer.alloc(16)]]), 1)).toThrow(
      'Key 1 must be 32 bytes',
    );
  });
});
