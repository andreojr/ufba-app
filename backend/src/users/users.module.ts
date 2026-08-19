import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { USER_REPOSITORY } from '../db/tokens';
import { UserRepository } from './user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [UsersController],
  providers: [
    {
      provide: UsersService,
      inject: [USER_REPOSITORY],
      useFactory: (userRepository: UserRepository) =>
        new UsersService(userRepository),
    },
  ],
})
export class UsersModule {}
