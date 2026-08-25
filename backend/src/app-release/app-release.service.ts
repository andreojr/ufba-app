import { Injectable, Optional } from '@nestjs/common';
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
  /**
   * From the asset's `Content-Length`, best-effort. Absent when it couldn't be
   * determined — a landing page showing no size is fine; a release that fails
   * to publish because GitHub was slow to answer a HEAD request is not.
   */
  fileSizeBytes?: number;
}

/** Resolves an asset URL to its byte size, or `undefined` if it can't tell. */
export type SizeFetcher = (url: string) => Promise<number | undefined>;

const SIZE_FETCH_TIMEOUT_MS = 3_000;

/** Real implementation: a plain HEAD request, same style as the rest of the backend's HTTP code. */
export const fetchSizeViaHead: SizeFetcher = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIZE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    const contentLength = response.headers.get('content-length');
    if (!contentLength) return undefined;
    const size = Number.parseInt(contentLength, 10);
    return Number.isInteger(size) ? size : undefined;
  } catch {
    // Network hiccup, timeout, GitHub having a bad day — none of that should
    // ever take down the version check itself.
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
};

const SIZE_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Reads the release off environment variables rather than a table: publishing
 * is `railway variables --set ...`, with no migration and no admin screen. The
 * response shape is what would outlive a move to the database, so the client
 * never has to change if that day comes.
 */
@Injectable()
export class AppReleaseService {
  private sizeCache: { url: string; size: number | undefined; fetchedAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    // SizeFetcher is a plain function type, not a class — Nest's DI can't
    // resolve a token for it and throws UnknownDependenciesException on boot
    // without @Optional() here. Tests inject a fake directly; production
    // gets undefined from Nest and falls back to the real HEAD fetcher.
    @Optional() private readonly fetchSize: SizeFetcher = fetchSizeViaHead,
  ) {}

  /** Null when nothing is published yet, or the configuration is incomplete. */
  async release(): Promise<AppRelease | null> {
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
      fileSizeBytes: await this.sizeOf(downloadUrl),
    };
  }

  /** A release's asset never changes size mid-flight, so a short cache spares GitHub a HEAD per request. */
  private async sizeOf(url: string): Promise<number | undefined> {
    const cached = this.sizeCache;
    if (cached && cached.url === url && Date.now() - cached.fetchedAt < SIZE_CACHE_TTL_MS) {
      return cached.size;
    }

    const size = await this.fetchSize(url);
    this.sizeCache = { url, size, fetchedAt: Date.now() };
    return size;
  }
}
