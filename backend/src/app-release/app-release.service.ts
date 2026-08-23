import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The currently published Android build, as the mobile client sees it. */
export interface AppRelease {
  /** Semver, compared against the installed app's own `expo.version`. */
  latestVersion: string;
  /** Android's monotonic build number — the system refuses to install a lower one. */
  versionCode: number;
  /** Stable GitHub Releases asset URL. EAS Build artifact URLs expire; never use those. */
  downloadUrl: string;
  releaseNotes: string;
  /** ISO 8601. */
  publishedAt: string;
}

/**
 * Reads the release off environment variables rather than a table: publishing
 * is `railway variables --set ...`, with no migration and no admin screen. The
 * response shape is what would outlive a move to the database, so the client
 * never has to change if that day comes.
 */
@Injectable()
export class AppReleaseService {
  constructor(private readonly config: ConfigService) {}

  /** Null when nothing is published yet, or the configuration is incomplete. */
  release(): AppRelease | null {
    const latestVersion = this.config.get<string>('APP_LATEST_VERSION');
    const rawVersionCode = this.config.get<string>('APP_LATEST_VERSION_CODE');
    const downloadUrl = this.config.get<string>('APP_DOWNLOAD_URL');
    const publishedAt = this.config.get<string>('APP_PUBLISHED_AT');

    if (!latestVersion || !rawVersionCode || !downloadUrl || !publishedAt) {
      return null;
    }

    const versionCode = Number.parseInt(rawVersionCode, 10);
    if (!Number.isInteger(versionCode)) {
      return null;
    }

    return {
      latestVersion,
      versionCode,
      downloadUrl,
      // A release with no notes is still a release — only the identifying
      // fields above are required.
      releaseNotes: this.config.get<string>('APP_RELEASE_NOTES') ?? '',
      publishedAt,
    };
  }
}
