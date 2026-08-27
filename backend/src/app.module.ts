import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppReleaseModule } from './app-release/app-release.module';
import { AuthModule } from './auth/auth.module';
import { DocentesModule } from './docentes/docentes.module';
import { SigaaEngineModule } from './sigaa-engine/sigaa-engine.module';
import { UsersModule } from './users/users.module';
import { CurriculoModule } from './curriculo/curriculo.module';
import { PontosAtencaoModule } from './pontos-atencao/pontos-atencao.module';
import { FaltasModule } from './faltas/faltas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppReleaseModule,
    AuthModule,
    SigaaEngineModule,
    DocentesModule,
    UsersModule,
    CurriculoModule,
    PontosAtencaoModule,
    FaltasModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
