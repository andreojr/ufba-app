import { File } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

import { baixarEInstalar, InstalacaoIndisponivelError } from "./app-update-install";

jest.mock("expo-file-system", () => {
  class FileFake {
    static downloadFileAsync = jest.fn();
    contentUri = "content://ufba/ufba-1.1.0.apk";
    delete = jest.fn();
    constructor(...uris: unknown[]) {
      (FileFake as unknown as { ultimaConstrucao: unknown[] }).ultimaConstrucao = uris;
    }
  }
  return { File: FileFake, Directory: class {}, Paths: { cache: { uri: "file:///cache/" } } };
});
jest.mock("expo-intent-launcher", () => ({
  startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
}));

const mockedIntent = jest.mocked(IntentLauncher);
const FileFake = File as unknown as {
  downloadFileAsync: jest.Mock;
  ultimaConstrucao: unknown[];
};

/** The File the download resolves to, so a test can inspect contentUri/delete. */
function baixado(): { contentUri: string; delete: jest.Mock } {
  const arquivo = new (File as unknown as new () => {
    contentUri: string;
    delete: jest.Mock;
  })();
  FileFake.downloadFileAsync.mockResolvedValue(arquivo);
  return arquivo;
}

describe("baixarEInstalar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("downloads into the cache directory under a version-stamped name", async () => {
    baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(FileFake.ultimaConstrucao[1]).toBe("ufba-1.1.0.apk");
    expect(FileFake.downloadFileAsync).toHaveBeenCalledWith(
      "https://example.com/app.apk",
      expect.anything(),
      expect.objectContaining({ idempotent: true }),
    );
  });

  it("reports progress as a 0..1 fraction", async () => {
    baixado();
    const progresso: (number | null)[] = [];

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", (f) => progresso.push(f));

    const { onProgress } = FileFake.downloadFileAsync.mock.calls[0][2];
    onProgress({ bytesWritten: 50, totalBytes: 200 });
    expect(progresso).toContain(0.25);
  });

  it("reports null when the server sends no Content-Length", async () => {
    baixado();
    const progresso: (number | null)[] = [];

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", (f) => progresso.push(f));

    const { onProgress } = FileFake.downloadFileAsync.mock.calls[0][2];
    // expo-file-system reports totalBytes as -1 in that case.
    onProgress({ bytesWritten: 50, totalBytes: -1 });
    expect(progresso).toContain(null);
  });

  it("fires the install intent with the file's content uri and read permission", async () => {
    baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(mockedIntent.startActivityAsync).toHaveBeenCalledWith(
      "android.intent.action.INSTALL_PACKAGE",
      expect.objectContaining({
        data: "content://ufba/ufba-1.1.0.apk",
        flags: 1,
      }),
    );
  });

  it("deletes the downloaded apk after handing it to the installer", async () => {
    const arquivo = baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(arquivo.delete).toHaveBeenCalled();
  });

  it("still deletes the file when the installer cannot be reached", async () => {
    const arquivo = baixado();
    mockedIntent.startActivityAsync.mockRejectedValue(new Error("no activity"));

    await expect(
      baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {}),
    ).rejects.toBeInstanceOf(InstalacaoIndisponivelError);
    expect(arquivo.delete).toHaveBeenCalled();
  });

  it("propagates a failed download without touching the installer", async () => {
    FileFake.downloadFileAsync.mockRejectedValue(new Error("network"));

    await expect(
      baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {}),
    ).rejects.toThrow("network");
    expect(mockedIntent.startActivityAsync).not.toHaveBeenCalled();
  });
});
