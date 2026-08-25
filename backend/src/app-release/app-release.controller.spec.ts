import { NotFoundException } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService, type AppRelease } from './app-release.service';

const RELEASE: AppRelease = {
  latestVersion: '1.1.0',
  versionCode: 3,
  downloadUrl: 'https://example.com/ufba-1.1.0.apk',
  releaseNotes: 'Optativas na Trajetória.',
  publishedAt: '2026-09-01T12:00:00Z',
};

function serviceFake(release: AppRelease | null): AppReleaseService {
  return { release: () => Promise.resolve(release) } as unknown as AppReleaseService;
}

describe('AppReleaseController', () => {
  it('returns the published release', async () => {
    const controller = new AppReleaseController(serviceFake(RELEASE));

    await expect(controller.version()).resolves.toEqual(RELEASE);
  });

  it('404s when nothing is published instead of returning a half-filled body', async () => {
    const controller = new AppReleaseController(serviceFake(null));

    await expect(controller.version()).rejects.toThrow(NotFoundException);
  });
});
