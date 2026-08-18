import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

export class InvalidEncryptionKeyError extends Error {
  constructor() {
    super(
      `SIGAA_CREDENTIAL_ENC_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (AES-256)`,
    );
    this.name = 'InvalidEncryptionKeyError';
  }
}

export class CredentialVaultDecryptionError extends Error {
  constructor() {
    super(
      'Failed to decrypt stored SIGAA credential (wrong key or tampered ciphertext)',
    );
    this.name = 'CredentialVaultDecryptionError';
  }
}

/** Parses a base64-encoded AES-256 key from an env var value. */
export function parseEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new InvalidEncryptionKeyError();
  }
  return key;
}

export interface EncryptedCredential {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface DecryptionAuditContext {
  userId: string;
  reason: string;
}

export interface DecryptionAuditEntry extends DecryptionAuditContext {
  decryptedAt: Date;
}

export interface AuditLogger {
  logDecryption(entry: DecryptionAuditEntry): void | Promise<void>;
}

export class CredentialVault {
  constructor(
    private readonly key: Buffer,
    private readonly auditLogger: AuditLogger,
  ) {}

  encrypt(plaintext: string): EncryptedCredential {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    return {
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  async decrypt(
    encrypted: EncryptedCredential,
    context: DecryptionAuditContext,
  ): Promise<string> {
    let plaintext: string;

    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(encrypted.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf-8');
    } catch {
      throw new CredentialVaultDecryptionError();
    }

    await this.auditLogger.logDecryption({
      ...context,
      decryptedAt: new Date(),
    });

    return plaintext;
  }
}
