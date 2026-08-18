import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SigaaEngineModule } from './sigaa-engine/sigaa-engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    SigaaEngineModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
