import * as SecureStore from "expo-secure-store";

import { getPeriodoCache, savePeriodoCache } from "./periodo-cache";

jest.mock("expo-secure-store");

describe("periodo-cache", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("round-trips the term through the store", async () => {
    const periodo = { semestre: "2026.1", inicio: "2026-03-02", fim: "2026-07-15" };
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(periodo));

    await savePeriodoCache(periodo);

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
});
