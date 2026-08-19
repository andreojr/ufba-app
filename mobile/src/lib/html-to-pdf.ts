import { File } from "expo-file-system";
import * as Print from "expo-print";

/**
 * Renders a self-contained HTML document to a PDF on the device and returns its
 * bytes. SIGAA serves the atestado de matrícula as a print-ready HTML page (not
 * a PDF), so the backend inlines its assets and we turn it into a PDF here —
 * keeping storage/UI identical to the histórico (both end up as saved PDF
 * bytes). The temp file expo-print writes to the cache is removed once read;
 * a cleanup failure never fails the generation.
 */
export async function htmlToPdfBytes(html: string): Promise<Uint8Array> {
  const { uri } = await Print.printToFileAsync({ html });
  const file = new File(uri);
  const bytes = await file.bytes();
  try {
    file.delete();
  } catch {
    // Best-effort cleanup of a cache temp — the bytes are already in hand.
  }
  return bytes;
}
