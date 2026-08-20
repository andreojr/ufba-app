import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import {
  AUDIT_LOGGER,
  HISTORICO_REPOSITORY,
  SCHEDULE_REPOSITORY,
  SIGAA_LINK_REPOSITORY,
  USER_REPOSITORY,
} from '../db/tokens';
import type { UserRepository } from '../users/user.repository';
import { AuditLogger } from './credential-vault';
import { CredentialVault, parseEncryptionKey } from './credential-vault';
import { HistoricoRepository } from './historico.repository';
import { HistoricoService } from './historico.service';
import { createSigaaHttpClient } from './http-client';
import { extrairItensHistorico } from './parsers/historico-texto';
import { parseHistorico } from './parsers/historico';
import { ScheduleController } from './schedule.controller';
import { ScheduleRepository } from './schedule.repository';
import { ScheduleService } from './schedule.service';
import { SigaaSession } from './session';
import {
  SigaaEngineService,
  SigaaSessionFactory,
} from './sigaa-engine.service';
import { SigaaLinkRepository, SigaaLinkService } from './sigaa-link.service';
import { SigaaController } from './sigaa.controller';
import { TrajetoriaController } from './trajetoria.controller';
import { CREDENTIAL_VAULT, SIGAA_SESSION_FACTORY } from './tokens';

@Module({
  imports: [ConfigModule, AuthModule, DatabaseModule],
  controllers: [SigaaController, TrajetoriaController, ScheduleController],
  providers: [
    {
      provide: SIGAA_SESSION_FACTORY,
      useValue: (() =>
        new SigaaSession(createSigaaHttpClient())) as SigaaSessionFactory,
    },
    {
      provide: CREDENTIAL_VAULT,
      inject: [ConfigService, AUDIT_LOGGER],
      useFactory: (config: ConfigService, auditLogger: AuditLogger) =>
        new CredentialVault(
          parseEncryptionKey(
            config.getOrThrow<string>('SIGAA_CREDENTIAL_ENC_KEY'),
          ),
          auditLogger,
        ),
    },
    {
      provide: SigaaEngineService,
      inject: [SIGAA_SESSION_FACTORY],
      useFactory: (sessionFactory: SigaaSessionFactory) =>
        new SigaaEngineService(sessionFactory),
    },
    {
      provide: SigaaLinkService,
      inject: [SIGAA_SESSION_FACTORY, CREDENTIAL_VAULT, SIGAA_LINK_REPOSITORY],
      useFactory: (
        sessionFactory: SigaaSessionFactory,
        vault: CredentialVault,
        repository: SigaaLinkRepository,
      ) => new SigaaLinkService(sessionFactory, vault, repository),
    },
    {
      provide: HistoricoService,
      inject: [SigaaEngineService, HISTORICO_REPOSITORY],
      useFactory: (
        engine: SigaaEngineService,
        repository: HistoricoRepository,
      ) =>
        new HistoricoService(
          engine,
          extrairItensHistorico,
          parseHistorico,
          repository,
        ),
    },
    {
      provide: ScheduleService,
      inject: [SigaaEngineService, USER_REPOSITORY, SCHEDULE_REPOSITORY],
      useFactory: (
        engine: SigaaEngineService,
        userRepository: UserRepository,
        repository: ScheduleRepository,
      ) => new ScheduleService(engine, userRepository, repository),
    },
  ],
})
export class SigaaEngineModule {}
