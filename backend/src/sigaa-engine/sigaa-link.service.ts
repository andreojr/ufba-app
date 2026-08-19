import { Injectable } from '@nestjs/common';
import { SigaaCredentials } from './session';
import type { SigaaSessionFactory } from './sigaa-engine.service';
import { CredentialVault, EncryptedCredential } from './credential-vault';

export interface SigaaLinkRecord {
  userId: string;
  sigaaLogin: string;
  encryptedSenha: EncryptedCredential;
  linkedAt: Date;
}

export interface SigaaLinkRepository {
  save(record: SigaaLinkRecord): Promise<void>;
  findByUserId(userId: string): Promise<SigaaLinkRecord | null>;
  delete(userId: string): Promise<void>;
}

@Injectable()
export class SigaaLinkService {
  constructor(
    private readonly createSession: SigaaSessionFactory,
    private readonly vault: CredentialVault,
    private readonly repository: SigaaLinkRepository,
  ) {}

  /**
   * Validates the SIGAA credential live (login attempt) before doing anything
   * else. Only persisted (encrypted) if the user opted into "lembrar senha";
   * otherwise any previously stored credential for this user is removed, so
   * turning the option off actually forgets it.
   */
  async link(
    userId: string,
    credentials: SigaaCredentials,
    rememberPassword: boolean,
  ): Promise<void> {
    const session = this.createSession();
    await session.login(credentials);

    if (!rememberPassword) {
      await this.repository.delete(userId);
      return;
    }

    const encryptedSenha = this.vault.encrypt(credentials.senha);
    await this.repository.save({
      userId,
      sigaaLogin: credentials.login,
      encryptedSenha,
      linkedAt: new Date(),
    });
  }

  /**
   * Restores a previously cloud-saved credential (e.g. after a reinstall or
   * on a new device). Decryption goes through the same audit-logged vault
   * path as every other decrypt.
   */
  async getLinkedCredentials(
    userId: string,
  ): Promise<
    { linked: false } | { linked: true; login: string; senha: string }
  > {
    const record = await this.repository.findByUserId(userId);
    if (!record) {
      return { linked: false };
    }

    const senha = await this.vault.decrypt(record.encryptedSenha, {
      userId,
      reason: 'mobile-restore',
    });

    return { linked: true, login: record.sigaaLogin, senha };
  }
}
