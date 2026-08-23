import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { UserRecord } from './user.repository';
import { UpdateAvatarDto } from './update-avatar.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // The client refreshes its cached user from here — the academic fields
  // (matricula/curso/periodoIngresso) only get captured after a schedule
  // fetch, i.e. after the login response the app originally stored.
  @Get('me')
  async getMe(@CurrentUser() user: RequestUser): Promise<UserRecord> {
    return this.usersService.getMe(user.userId);
  }

  @Post('me/avatar')
  async updateAvatar(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateAvatarDto,
  ): Promise<{ avatarUrl: string }> {
    await this.usersService.updateAvatar(user.userId, dto.avatarUrl);
    return { avatarUrl: dto.avatarUrl };
  }

  // Addresses the student by the JWT's `sub` alone — there is no route
  // parameter to tamper with, so no one can erase anybody else.
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eraseAccount(@CurrentUser() user: RequestUser): Promise<void> {
    await this.usersService.eraseAccount(user.userId);
  }
}
