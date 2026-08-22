import { Module } from '@nestjs/common';
import { createSigaaHttpClient } from '../sigaa-engine/http-client';
import { DatabaseModule } from '../db/database.module';
import { CURRICULO_REPOSITORY, HISTORICO_REPOSITORY } from '../db/tokens';
import type { CurriculoRepository } from './curriculo.repository';
import type { HistoricoRepository } from '../sigaa-engine/historico.repository';
import { CurriculoController } from './curriculo.controller';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

@Module({
  imports: [DatabaseModule],
  controllers: [CurriculoController],
  providers: [
    {
      provide: CURRICULO_SERVICE,
      inject: [CURRICULO_REPOSITORY, HISTORICO_REPOSITORY],
      useFactory: (
        repository: CurriculoRepository,
        historicoRepository: HistoricoRepository,
      ) =>
        new CurriculoService(
          createSigaaHttpClient(),
          repository,
          () => new Date(),
          historicoRepository,
        ),
    },
  ],
  exports: [CURRICULO_SERVICE],
})
export class CurriculoModule {}
