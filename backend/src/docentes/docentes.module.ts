import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { DOCENTE_REPOSITORY } from '../db/tokens';
import { createSigaaHttpClient } from '../sigaa-engine/http-client';
import { PublicSigaaSession } from '../sigaa-engine/public-session';
import type { DocenteRepository } from './docente.repository';
import { DocentesController } from './docentes.controller';
import { DocentesService } from './docentes.service';

/**
 * Deliberately not part of SigaaEngineModule: that module is "things that need
 * the student's SIGAA credentials". A docente profile is the opposite — public,
 * global, and tied to no user.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DocentesController],
  providers: [
    {
      provide: DocentesService,
      inject: [DOCENTE_REPOSITORY],
      useFactory: (repositorio: DocenteRepository) => {
        const http = createSigaaHttpClient();
        return new DocentesService(
          repositorio,
          http,
          () => new PublicSigaaSession(http),
        );
      },
    },
  ],
})
export class DocentesModule {}
