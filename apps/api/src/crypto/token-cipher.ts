import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = /^v(\d{1,4})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/;

export type TokenField = 'accessToken' | 'refreshToken';

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

/**
 * AES-256-GCM encryption of provider tokens at rest (ADR-0005).
 * Format: `v<keyVersion>.<base64url iv>.<base64url ciphertext>.<base64url tag>`.
 * AAD binds a ciphertext to one integration row and field, so copying it elsewhere fails.
 * Encrypts with the active key; decrypts with the version named in the prefix (rotation).
 */
export class TokenCipher {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly activeVersion: number,
  ) {
    const active = keys.get(activeVersion);
    if (!active)
      throw new TokenCipherError(`Active key version ${activeVersion} is not configured`);
    for (const [version, key] of keys) {
      if (key.length !== 32) throw new TokenCipherError(`Key ${version} must be 32 bytes`);
    }
  }

  static aad(integrationId: string, field: TokenField): string {
    return `integration:${integrationId}:${field}`;
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.activeVersion);
    if (!key) throw new TokenCipherError('Active key missing');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      `v${this.activeVersion}`,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, aad: string): string {
    const match = FORMAT.exec(payload);
    if (!match) throw new TokenCipherError('Malformed ciphertext');
    const version = Number(match[1]);
    const key = this.keys.get(version);
    if (!key) throw new TokenCipherError(`Unknown key version ${version}`);
    const iv = Buffer.from(match[2] ?? '', 'base64url');
    const ciphertext = Buffer.from(match[3] ?? '', 'base64url');
    const tag = Buffer.from(match[4] ?? '', 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new TokenCipherError('Malformed ciphertext');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key, wrong AAD or tampered data: never reveal which.
      throw new TokenCipherError('Ciphertext failed authentication');
    }
  }

  /** Version a stored value was encrypted with (for the re-encryption script). */
  static versionOf(payload: string): number | null {
    const match = FORMAT.exec(payload);
    return match ? Number(match[1]) : null;
  }

  get active(): number {
    return this.activeVersion;
  }
}

/** Nest provider wrapping TokenCipher with the validated env keys. */
@Injectable()
export class TokenCipherService extends TokenCipher {
  constructor(config: ConfigService<Env, true>) {
    super(
      config.get('TOKEN_ENCRYPTION_KEYS', { infer: true }),
      config.get('TOKEN_ENCRYPTION_ACTIVE_KEY', { infer: true }),
    );
  }
}
