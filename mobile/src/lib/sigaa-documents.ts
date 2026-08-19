import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { DocumentKey } from "./mock-data";

export interface SavedSigaaDocument {
  uri: string;
  size: number;
  savedAt: Date;
}

/** One file per document type — regenerating always replaces the previous copy. */
const FILE_NAMES: Record<DocumentKey, string> = {
  atestado: "atestado-matricula.pdf",
  historico: "historico-escolar.pdf",
};

/** Suffix of the scratch file new bytes are written to before replacing the real one. */
const SCRATCH_SUFFIX = ".part";

function documentFile(key: DocumentKey): File {
  return new File(Paths.document, FILE_NAMES[key]);
}

function scratchFile(key: DocumentKey): File {
  return new File(Paths.document, `${FILE_NAMES[key]}${SCRATCH_SUFFIX}`);
}

function describe(file: File): SavedSigaaDocument {
  return {
    uri: file.uri,
    size: file.size,
    savedAt: file.modificationTime ? new Date(file.modificationTime) : new Date(),
  };
}

/**
 * Persists the given PDF bytes, replacing any previous copy of that document
 * type. Writing straight over the existing file would leave a truncated PDF in
 * its place if the app died mid-write, so the new bytes land in a scratch file
 * first and only replace the real one once they're all on disk. Note that
 * `move` never overwrites (iOS FileManager.moveItem and Android Path.moveTo
 * both throw on an existing destination), hence the explicit delete — the
 * sliver of time where only the scratch file exists is recovered by
 * `getSavedSigaaDocument`.
 */
export function saveSigaaDocument(key: DocumentKey, bytes: Uint8Array): SavedSigaaDocument {
  const scratch = scratchFile(key);
  if (scratch.exists) {
    scratch.delete();
  }
  scratch.create();
  scratch.write(bytes);

  const target = documentFile(key);
  if (target.exists) {
    target.delete();
  }
  scratch.move(target);

  return describe(documentFile(key));
}

/**
 * Opens the native share/"open with" sheet for an already-saved document — the
 * tap target for a row in the "No aparelho" list. Expo has no built-in PDF
 * viewer, so handing off to whatever app the user picks (a PDF viewer, Drive,
 * etc.) is the standard way to let them view a locally-saved file.
 */
export async function openSavedSigaaDocument(document: SavedSigaaDocument): Promise<void> {
  await Sharing.shareAsync(document.uri, {
    mimeType: "application/pdf",
    dialogTitle: "Abrir documento",
  });
}

/** Returns info about a document already saved on this device, or null if it hasn't been downloaded yet. */
export function getSavedSigaaDocument(key: DocumentKey): SavedSigaaDocument | null {
  const file = documentFile(key);
  if (file.exists) {
    return describe(file);
  }

  // No real file but a scratch one left over: the app died in `saveSigaaDocument`
  // between removing the old copy and moving the new one into place. That window
  // opens only after the new bytes were fully written, so the scratch file is
  // complete — finish the interrupted save instead of reporting nothing saved.
  const scratch = scratchFile(key);
  if (scratch.exists) {
    scratch.move(documentFile(key));
    return describe(documentFile(key));
  }

  return null;
}
