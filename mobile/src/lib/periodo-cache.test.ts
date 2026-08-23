import * as SecureStore from "expo-secure-store";

import { clearPeriodoCache, getPeriodoCache, savePeriodoCache } from "./periodo-cache";

jest.mock("expo-secure-store");

describe("periodo-cache", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("saves the term as JSON under the periodo key", async () => {
    // Asserts what the writer actually did, not just what a stubbed reader
    // hands back afterwards — a save() writing to the wrong key, or nothing at
    // all, would still pass a test that only stubs getItemAsync's return value.
    const periodo = { semestre: "2026.1", inicio: "2026-03-02", fim: "2026-07-15" };

    await savePeriodoCache(periodo);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.periodo",
      JSON.stringify(periodo),
    );
  });

  it("round-trips the term through the store", async () => {
    const periodo = { semestre: "2026.1", inicio: "2026-03-02", fim: "2026-07-15" };
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(periodo));

    await expect(getPeriodoCache()).resolves.toEqual(periodo);
  });

  it("reports null when nothing was ever cached", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("reports null instead of throwing on corrupted contents", async () => {
    // Same defensive shape as sigaa-storage.ts: a bad read must degrade to "no
    // cached date", which makes the nudge stay quiet rather than crash a screen.
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("{ not json");

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("ignores a stored value missing the field the caller needs", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ semestre: "2026.1" }));

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("reports null when SecureStore.getItemAsync rejects", async () => {
    // The try/catch's other arm: sigaa-storage.test.ts covers the same case
    // for its own cache, and it's the one that actually protects the screen —
    // a corrupted-JSON test alone never exercises the store itself throwing.
    jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error("Keystore decryption failed"));

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("clears the cached term", async () => {
    await clearPeriodoCache();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("gradline.periodo");
  });
});
