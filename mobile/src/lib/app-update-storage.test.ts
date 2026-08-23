import * as SecureStore from "expo-secure-store";

import {
  dispensarVersao,
  getUltimaChecagem,
  getVersaoDispensada,
  marcarChecagem,
} from "./app-update-storage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

describe("app-update-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has no dismissed version by default", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getVersaoDispensada()).resolves.toBeNull();
  });

  it("persists the dismissed version under its own key", async () => {
    await dispensarVersao("1.1.0");

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.update-dismissed",
      "1.1.0",
    );
  });

  it("returns the dismissed version", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("1.1.0");

    await expect(getVersaoDispensada()).resolves.toBe("1.1.0");
  });

  it("reads back the last check as a number", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("1756000000000");

    await expect(getUltimaChecagem()).resolves.toBe(1756000000000);
  });

  it("treats a corrupted timestamp as never checked", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("nao-e-numero");

    await expect(getUltimaChecagem()).resolves.toBeNull();
  });

  it("persists the check timestamp", async () => {
    await marcarChecagem(1756000000000);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.update-last-check",
      "1756000000000",
    );
  });
});
