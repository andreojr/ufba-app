import * as Sharing from "expo-sharing";

import { deleteSigaaDocument, getSavedSigaaDocument, openSavedSigaaDocument, saveSigaaDocument } from "./sigaa-documents";

jest.mock("expo-sharing", () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-file-system", () => {
  const files = new Map<string, { bytes: Uint8Array; modificationTime: number }>();
  // Lets a test simulate the app dying mid-write (the crash the atomic save protects against).
  const failures = { writeOnce: false };

  class FakeFile {
    uri: string;
    key: string;

    constructor(...uris: unknown[]) {
      this.key = uris.map((part) => (typeof part === "string" ? part : "")).join("/");
      this.uri = `file:///document/${this.key}`;
    }

    get exists(): boolean {
      return files.has(this.key);
    }

    get size(): number {
      return files.get(this.key)?.bytes.length ?? 0;
    }

    get modificationTime(): number | null {
      return files.get(this.key)?.modificationTime ?? null;
    }

    create(): void {
      if (!files.has(this.key)) {
        files.set(this.key, { bytes: new Uint8Array(), modificationTime: 0 });
      }
    }

    write(content: Uint8Array): void {
      if (failures.writeOnce) {
        failures.writeOnce = false;
        throw new Error("simulated write failure");
      }
      files.set(this.key, { bytes: content, modificationTime: Date.now() });
    }

    // Mirrors the real API: moving onto an existing path throws (iOS
    // FileManager.moveItem / Android Path.moveTo without overwrite).
    move(destination: FakeFile): void {
      if (files.has(destination.key)) {
        throw new Error(`destination already exists: ${destination.key}`);
      }
      const content = files.get(this.key);
      if (!content) {
        throw new Error(`no such file: ${this.key}`);
      }
      files.delete(this.key);
      files.set(destination.key, content);
      this.key = destination.key;
      this.uri = destination.uri;
    }

    delete(): void {
      files.delete(this.key);
    }
  }

  return {
    File: FakeFile,
    Paths: { document: "document" },
    __files: files,
    __failures: failures,
  };
});

const fileSystemMock = jest.requireMock("expo-file-system") as {
  __files: Map<string, { bytes: Uint8Array; modificationTime: number }>;
  __failures: { writeOnce: boolean };
};

beforeEach(() => {
  fileSystemMock.__files.clear();
  fileSystemMock.__failures.writeOnce = false;
});

describe("saveSigaaDocument", () => {
  it("writes the PDF bytes to the document directory and returns its info", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    const saved = saveSigaaDocument("historico", bytes);

    expect(saved.uri).toContain("historico-escolar.pdf");
    expect(saved.size).toBe(4);
  });

  it("overwrites a previously saved document of the same type", () => {
    saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));

    const saved = saveSigaaDocument("historico", new Uint8Array([1, 2, 3, 4, 5]));

    expect(saved.size).toBe(5);
  });

  it("leaves no scratch file behind once the save completes", () => {
    saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));

    const leftovers = [...fileSystemMock.__files.keys()].filter((key) => key.endsWith(".part"));
    expect(leftovers).toEqual([]);
  });

  it("keeps the previous copy intact when writing the new bytes fails (no truncated PDF in its place)", () => {
    saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));
    fileSystemMock.__failures.writeOnce = true;

    expect(() => saveSigaaDocument("historico", new Uint8Array([9, 9, 9, 9, 9]))).toThrow(
      /simulated write failure/,
    );

    const saved = getSavedSigaaDocument("historico");
    expect(saved?.size).toBe(3);
  });
});

describe("getSavedSigaaDocument", () => {
  it("returns null when the document was never saved", () => {
    expect(getSavedSigaaDocument("atestado")).toBeNull();
  });

  it("returns the file info after it has been saved", () => {
    saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));

    const saved = getSavedSigaaDocument("historico");

    expect(saved).not.toBeNull();
    expect(saved?.size).toBe(3);
  });

  it("recovers a complete scratch file left by a crash between the delete and the move", () => {
    // This state is only reachable after the new bytes were fully written and
    // the old copy removed — so the scratch file is whole and is the document.
    fileSystemMock.__files.set("document/historico-escolar.pdf.part", {
      bytes: new Uint8Array([1, 2, 3, 4]),
      modificationTime: 0,
    });

    const saved = getSavedSigaaDocument("historico");

    expect(saved?.size).toBe(4);
    expect(saved?.uri).toContain("historico-escolar.pdf");
    expect(saved?.uri).not.toContain(".part");
    expect(fileSystemMock.__files.has("document/historico-escolar.pdf.part")).toBe(false);
  });
});

describe("deleteSigaaDocument", () => {
  it("removes a previously saved document from the device", () => {
    saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));

    deleteSigaaDocument("historico");

    expect(getSavedSigaaDocument("historico")).toBeNull();
  });

  it("is a no-op when the document was never saved", () => {
    expect(() => deleteSigaaDocument("atestado")).not.toThrow();
  });
});

describe("openSavedSigaaDocument", () => {
  it("opens the file's share/view sheet as a PDF", async () => {
    const saved = saveSigaaDocument("historico", new Uint8Array([1, 2, 3]));

    await openSavedSigaaDocument(saved);

    expect(Sharing.shareAsync).toHaveBeenCalledWith(saved.uri, {
      mimeType: "application/pdf",
      dialogTitle: "Abrir documento",
    });
  });
});
