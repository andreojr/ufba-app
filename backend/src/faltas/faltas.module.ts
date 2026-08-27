import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { FALTAS_REPOSITORY } from '../db/tokens';
import { FaltasController } from './faltas.controller';
import type { FaltasRepository } from './faltas.repository';
import { FaltasService } from './faltas.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [FaltasController],
  providers: [
    {
      provide: FaltasService,
      inject: [FALTAS_REPOSITORY],
      useFactory: (repository: FaltasRepository) =>
        new FaltasService(repository),
    },
  ],
})
export class FaltasModule {}
