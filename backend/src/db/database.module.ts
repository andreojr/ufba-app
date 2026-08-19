import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaSigaaLinkRepository } from './prisma-sigaa-link.repository';
import { PrismaAuditLogger } from './prisma-audit-logger';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaHistoricoRepository } from './prisma-historico.repository';
import {
  AUDIT_LOGGER,
  HISTORICO_REPOSITORY,
  SIGAA_LINK_REPOSITORY,
  USER_REPOSITORY,
} from './tokens';

@Module({
  providers: [
    PrismaService,
    {
      provide: SIGAA_LINK_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaSigaaLinkRepository(prisma),
    },
    {
      provide: AUDIT_LOGGER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaAuditLogger(prisma),
    },
    {
      provide: USER_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaUserRepository(prisma),
    },
    {
      provide: HISTORICO_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaHistoricoRepository(prisma),
    },
  ],
  exports: [
    PrismaService,
    SIGAA_LINK_REPOSITORY,
    AUDIT_LOGGER,
    USER_REPOSITORY,
    HISTORICO_REPOSITORY,
  ],
})
export class DatabaseModule {}
