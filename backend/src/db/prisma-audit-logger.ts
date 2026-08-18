import {
  AuditLogger,
  DecryptionAuditEntry,
} from '../sigaa-engine/credential-vault';
import { PrismaService } from './prisma.service';

const ACTION_CREDENTIAL_DECRYPTED = 'sigaa_credential_decrypted';

export class PrismaAuditLogger implements AuditLogger {
  constructor(private readonly prisma: PrismaService) {}

  async logDecryption(entry: DecryptionAuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: ACTION_CREDENTIAL_DECRYPTED,
        reason: entry.reason,
        createdAt: entry.decryptedAt,
      },
    });
  }
}
