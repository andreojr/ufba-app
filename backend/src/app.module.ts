import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SigaaEngineModule } from './sigaa-engine/sigaa-engine.module';
import { UsersModule } from './users/users.module';
import { CurriculoModule } from './curriculo/curriculo.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    SigaaEngineModule,
    UsersModule,
    CurriculoModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
