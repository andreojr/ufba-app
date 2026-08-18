import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaSigaaLinkRepository } from './prisma-sigaa-link.repository';
import { PrismaAuditLogger } from './prisma-audit-logger';
import { AUDIT_LOGGER, SIGAA_LINK_REPOSITORY } from './tokens';

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
  ],
  exports: [PrismaService, SIGAA_LINK_REPOSITORY, AUDIT_LOGGER],
})
export class DatabaseModule {}
