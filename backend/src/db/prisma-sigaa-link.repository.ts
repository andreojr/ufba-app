import {
  SigaaLinkRecord,
  SigaaLinkRepository,
} from '../sigaa-engine/sigaa-link.service';
import { PrismaService } from './prisma.service';

export class PrismaSigaaLinkRepository implements SigaaLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: SigaaLinkRecord): Promise<void> {
    await this.prisma.sigaaLink.upsert({
      where: { userId: record.userId },
      create: {
        userId: record.userId,
        sigaaLogin: record.sigaaLogin,
        encryptedSenhaIv: record.encryptedSenha.iv,
        encryptedSenhaAuthTag: record.encryptedSenha.authTag,
        encryptedSenhaCiphertext: record.encryptedSenha.ciphertext,
        linkedAt: record.linkedAt,
      },
      update: {
        sigaaLogin: record.sigaaLogin,
        encryptedSenhaIv: record.encryptedSenha.iv,
        encryptedSenhaAuthTag: record.encryptedSenha.authTag,
        encryptedSenhaCiphertext: record.encryptedSenha.ciphertext,
      },
    });
  }

  async findByUserId(userId: string): Promise<SigaaLinkRecord | null> {
    const row = await this.prisma.sigaaLink.findUnique({ where: { userId } });
    if (!row) return null;

    return {
      userId: row.userId,
      sigaaLogin: row.sigaaLogin,
      encryptedSenha: {
        iv: row.encryptedSenhaIv,
        authTag: row.encryptedSenhaAuthTag,
        ciphertext: row.encryptedSenhaCiphertext,
      },
      linkedAt: row.linkedAt,
    };
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.sigaaLink.deleteMany({ where: { userId } });
  }
}
