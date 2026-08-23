import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaSigaaLinkRepository } from './prisma-sigaa-link.repository';
import { PrismaAuditLogger } from './prisma-audit-logger';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaHistoricoRepository } from './prisma-historico.repository';
import { PrismaScheduleRepository } from './prisma-schedule.repository';
import { PrismaDocenteRepository } from './prisma-docente.repository';
import { PrismaCurriculoRepository } from './prisma-curriculo.repository';
import { PrismaPontoAtencaoRepository } from './prisma-ponto-atencao.repository';
import {
  AUDIT_LOGGER,
  CURRICULO_REPOSITORY,
  DOCENTE_REPOSITORY,
  HISTORICO_REPOSITORY,
  PONTO_ATENCAO_REPOSITORY,
  SCHEDULE_REPOSITORY,
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
      useFactory: (prisma: PrismaService) =>
        new PrismaHistoricoRepository(prisma),
    },
    {
      provide: SCHEDULE_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaScheduleRepository(prisma),
    },
    {
      provide: DOCENTE_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaDocenteRepository(prisma),
    },
    {
      provide: CURRICULO_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaCurriculoRepository(prisma),
    },
    {
      provide: PONTO_ATENCAO_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaPontoAtencaoRepository(prisma),
    },
  ],
  exports: [
    PrismaService,
    SIGAA_LINK_REPOSITORY,
    AUDIT_LOGGER,
    USER_REPOSITORY,
    HISTORICO_REPOSITORY,
    SCHEDULE_REPOSITORY,
    DOCENTE_REPOSITORY,
    CURRICULO_REPOSITORY,
    PONTO_ATENCAO_REPOSITORY,
  ],
})
export class DatabaseModule {}
