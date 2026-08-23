import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

/**
 * Downloads the published APK and hands it to Android's package installer.
 *
 * Deliberately on the modern expo-file-system API, never `expo-file-system/legacy`:
 * the legacy surface is deprecated, and since SDK 56 the modern one covers both
 * things this needs — `onProgress` on the download, and `File#contentUri`
 * (Android), which is the FileProvider `content://` URI the installer requires.
 *
 * The file lands in the cache directory, not Downloads: invisible to the file
 * manager, deletable by the system under storage pressure, and deleted here as
 * soon as the installer has it.
 */

/** Android's install intent. Not exported by expo-intent-launcher as a constant. */
const ACTION_INSTALL_PACKAGE = "android.intent.action.INSTALL_PACKAGE";
/** FLAG_GRANT_READ_URI_PERMISSION — without it the installer cannot read the uri. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** The installer could not be reached — the caller should fall back to the site. */
export class InstalacaoIndisponivelError extends Error {
  constructor() {
    super("Não foi possível abrir o instalador do sistema");
    this.name = "InstalacaoIndisponivelError";
  }
}

export async function baixarEInstalar(
  downloadUrl: string,
  versao: string,
  onProgresso: (fracao: number | null) => void,
): Promise<void> {
  const destino = new File(Paths.cache, `gradline-${versao}.apk`);

  // A failed download leaves nothing worth cleaning up and nothing to install.
  // `idempotent` so a retry after a partial download overwrites instead of throwing.
  const arquivo = await File.downloadFileAsync(downloadUrl, destino, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // totalBytes is -1 when the server sent no Content-Length. There is no
      // fraction to report then, and the card shows an indeterminate state
      // rather than a number the download cannot back up.
      onProgresso(totalBytes > 0 ? bytesWritten / totalBytes : null);
    },
  });

  try {
    await IntentLauncher.startActivityAsync(ACTION_INSTALL_PACKAGE, {
      data: arquivo.contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch {
    throw new InstalacaoIndisponivelError();
  } finally {
    // The installer has already copied what it needs by the time the intent
    // returns; keeping the apk around would be the "duplicate file" problem
    // this whole approach exists to avoid.
    try {
      arquivo.delete();
    } catch {
      // A file the system already reclaimed is not a failure worth surfacing.
    }
  }
}
