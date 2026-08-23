import { ConfigService } from '@nestjs/config';
import { AppReleaseService } from './app-release.service';

function configFake(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const COMPLETE = {
  APP_LATEST_VERSION: '1.1.0',
  APP_LATEST_VERSION_CODE: '3',
  APP_DOWNLOAD_URL: 'https://example.com/ufba-1.1.0.apk',
  APP_RELEASE_NOTES: 'Optativas na Trajetória.',
  APP_PUBLISHED_AT: '2026-09-01T12:00:00Z',
};

describe('AppReleaseService', () => {
  it('reads the published release off the environment', () => {
    const service = new AppReleaseService(configFake(COMPLETE));

    expect(service.release()).toEqual({
      latestVersion: '1.1.0',
      versionCode: 3,
      downloadUrl: 'https://example.com/ufba-1.1.0.apk',
      releaseNotes: 'Optativas na Trajetória.',
      publishedAt: '2026-09-01T12:00:00Z',
    });
  });

  it('reports nothing published when a required variable is missing', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_DOWNLOAD_URL: undefined }),
    );

    expect(service.release()).toBeNull();
  });

  it('reports nothing published when the version code is not an integer', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_LATEST_VERSION_CODE: 'three' }),
    );

    expect(service.release()).toBeNull();
  });

  it('treats absent release notes as empty rather than unpublished', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_RELEASE_NOTES: undefined }),
    );

    expect(service.release()?.releaseNotes).toBe('');
  });
});
