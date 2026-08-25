import { Controller, Get, NotFoundException } from '@nestjs/common';
import { AppReleaseService, type AppRelease } from './app-release.service';

/**
 * Deliberately NOT behind JwtAuthGuard: the app checks for updates before the
 * user has signed in, and the payload is the same public information the
 * landing page already serves.
 */
@Controller('app')
export class AppReleaseController {
  constructor(private readonly service: AppReleaseService) {}

  @Get('version')
  async version(): Promise<AppRelease> {
    const release = await this.service.release();
    if (!release) {
      throw new NotFoundException('No app release is published');
    }
    return release;
  }
}
