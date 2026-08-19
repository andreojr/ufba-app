import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../db/database.module';
import { USER_REPOSITORY } from '../db/tokens';
import { UserRepository } from '../users/user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleTokenService } from './google-token.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    DatabaseModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [GoogleTokenService, JwtService, USER_REPOSITORY],
      useFactory: (
        googleTokenService: GoogleTokenService,
        jwtService: JwtService,
        userRepository: UserRepository,
      ) => new AuthService(googleTokenService, jwtService, userRepository),
    },
    {
      provide: GoogleTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GoogleTokenService(config.getOrThrow<string>('GOOGLE_CLIENT_ID')),
    },
    {
      provide: JwtStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new JwtStrategy(config),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
