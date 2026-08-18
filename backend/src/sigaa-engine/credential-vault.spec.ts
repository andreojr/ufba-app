import { randomBytes } from 'node:crypto';
import {
  CredentialVault,
  parseEncryptionKey,
  InvalidEncryptionKeyError,
  CredentialVaultDecryptionError,
} from './credential-vault';

function fakeAuditLogger() {
  return { logDecryption: jest.fn() };
}

describe('CredentialVault', () => {
  const key = randomBytes(32);

  it('decrypts back to the original plaintext', async () => {
    const vault = new CredentialVault(key, fakeAuditLogger());

    const encrypted = vault.encrypt('senha-super-secreta');
    const decrypted = await vault.decrypt(encrypted, {
      userId: 'user-1',
      reason: 'background notification fetch',
    });

    expect(decrypted).toBe('senha-super-secreta');
  });

  it('produces different ciphertext for the same plaintext on repeated calls (random IV)', () => {
    const vault = new CredentialVault(key, fakeAuditLogger());

    const first = vault.encrypt('senha-super-secreta');
    const second = vault.encrypt('senha-super-secreta');

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it('logs an audit entry every time a credential is decrypted', async () => {
    const auditLogger = fakeAuditLogger();
    const vault = new CredentialVault(key, auditLogger);
    const encrypted = vault.encrypt('senha-super-secreta');

    await vault.decrypt(encrypted, {
      userId: 'user-1',
      reason: 'background notification fetch',
    });

    expect(auditLogger.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        reason: 'background notification fetch',
      }),
    );
  });

  it('throws CredentialVaultDecryptionError when the ciphertext has been tampered with', async () => {
    const vault = new CredentialVault(key, fakeAuditLogger());
    const encrypted = vault.encrypt('senha-super-secreta');
    const tampered = {
      ...encrypted,
      authTag: Buffer.alloc(16, 0).toString('base64'),
    };

    await expect(
      vault.decrypt(tampered, { userId: 'user-1', reason: 'test' }),
    ).rejects.toThrow(CredentialVaultDecryptionError);
  });

  it('does not log an audit entry when decryption fails', async () => {
    const auditLogger = fakeAuditLogger();
    const vault = new CredentialVault(key, auditLogger);
    const encrypted = vault.encrypt('senha-super-secreta');
    const tampered = {
      ...encrypted,
      authTag: Buffer.alloc(16, 0).toString('base64'),
    };

    await expect(
      vault.decrypt(tampered, { userId: 'user-1', reason: 'test' }),
    ).rejects.toThrow();
    expect(auditLogger.logDecryption).not.toHaveBeenCalled();
  });

  it('throws when decrypting with the wrong key', async () => {
    const vault = new CredentialVault(key, fakeAuditLogger());
    const encrypted = vault.encrypt('senha-super-secreta');
    const otherVault = new CredentialVault(randomBytes(32), fakeAuditLogger());

    await expect(
      otherVault.decrypt(encrypted, { userId: 'user-1', reason: 'test' }),
    ).rejects.toThrow(CredentialVaultDecryptionError);
  });
});

describe('parseEncryptionKey', () => {
  it('parses a base64-encoded 32-byte key', () => {
    const raw = randomBytes(32);
    const parsed = parseEncryptionKey(raw.toString('base64'));

    expect(parsed).toEqual(raw);
  });

  it('throws InvalidEncryptionKeyError for a key shorter than 32 bytes', () => {
    const raw = randomBytes(16);

    expect(() => parseEncryptionKey(raw.toString('base64'))).toThrow(
      InvalidEncryptionKeyError,
    );
  });
});
