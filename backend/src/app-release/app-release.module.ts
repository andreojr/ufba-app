import { Module } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';

/** No AuthModule and no DatabaseModule — this module reads only the environment. */
@Module({
  controllers: [AppReleaseController],
  providers: [AppReleaseService],
})
export class AppReleaseModule {}
