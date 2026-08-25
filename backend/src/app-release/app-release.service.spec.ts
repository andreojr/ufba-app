import { ConfigService } from '@nestjs/config';
import { AppReleaseService, type SizeFetcher } from './app-release.service';

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

/** Never touches the network — every test controls exactly what the "HEAD" would report. */
function sizeFetcherFake(result: number | undefined): SizeFetcher {
  return async () => result;
}

describe('AppReleaseService', () => {
  it('reads the published release off the environment', async () => {
    const service = new AppReleaseService(configFake(COMPLETE), sizeFetcherFake(undefined));

    await expect(service.release()).resolves.toEqual({
      latestVersion: '1.1.0',
      versionCode: 3,
      downloadUrl: 'https://example.com/ufba-1.1.0.apk',
      releaseNotes: 'Optativas na Trajetória.',
      publishedAt: '2026-09-01T12:00:00Z',
    });
  });

  it('reports nothing published when a required variable is missing', async () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_DOWNLOAD_URL: undefined }),
      sizeFetcherFake(undefined),
    );

    await expect(service.release()).resolves.toBeNull();
  });

  it('reports nothing published when the version code is not an integer', async () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_LATEST_VERSION_CODE: 'three' }),
      sizeFetcherFake(undefined),
    );

    await expect(service.release()).resolves.toBeNull();
  });

  it('treats absent release notes as empty rather than unpublished', async () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_RELEASE_NOTES: undefined }),
      sizeFetcherFake(undefined),
    );

    const release = await service.release();
    expect(release?.releaseNotes).toBe('');
  });

  it('includes the asset size when the fetcher can determine it', async () => {
    const service = new AppReleaseService(configFake(COMPLETE), sizeFetcherFake(52_428_800));

    const release = await service.release();
    expect(release?.fileSizeBytes).toBe(52_428_800);
  });

  it('omits the asset size rather than failing the release when the fetcher can\'t tell', async () => {
    const service = new AppReleaseService(configFake(COMPLETE), sizeFetcherFake(undefined));

    const release = await service.release();
    expect(release?.fileSizeBytes).toBeUndefined();
  });

  it('caches the asset size instead of asking on every call', async () => {
    let calls = 0;
    const fetcher: SizeFetcher = async () => {
      calls += 1;
      return 1_000;
    };
    const service = new AppReleaseService(configFake(COMPLETE), fetcher);

    await service.release();
    await service.release();

    expect(calls).toBe(1);
  });

  it('refetches the size when the download URL changes', async () => {
    let calls = 0;
    const fetcher: SizeFetcher = async () => {
      calls += 1;
      return 1_000;
    };
    const values: Record<string, string | undefined> = { ...COMPLETE };
    const service = new AppReleaseService(configFake(values), fetcher);

    await service.release();
    values.APP_DOWNLOAD_URL = 'https://example.com/other.apk';
    await service.release();

    expect(calls).toBe(2);
  });
});
