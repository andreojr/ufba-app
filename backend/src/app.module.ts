import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SigaaEngineModule } from './sigaa-engine/sigaa-engine.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    SigaaEngineModule,
    UsersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
