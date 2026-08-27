import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { PONTO_ATENCAO_REPOSITORY } from '../db/tokens';
import { PontoAtencaoController } from './ponto-atencao.controller';
import type { PontoAtencaoRepository } from './ponto-atencao.repository';
import { PontoAtencaoService } from './ponto-atencao.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PontoAtencaoController],
  providers: [
    {
      provide: PontoAtencaoService,
      inject: [PONTO_ATENCAO_REPOSITORY],
      useFactory: (repository: PontoAtencaoRepository) =>
        new PontoAtencaoService(repository),
    },
  ],
  // TurmaVirtualController converte avaliações da Turma Virtual em Ponto de
  // Atenção — ver sincronizarDaTurmaVirtual.
  exports: [PontoAtencaoService],
})
export class PontosAtencaoModule {}
