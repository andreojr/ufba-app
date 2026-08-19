import * as SecureStore from "expo-secure-store";

import {
  clearSigaaCredentials,
  getSigaaCredentials,
  saveSigaaCredentials,
} from "./sigaa-storage";
import type { SigaaCredentials } from "./types";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

const CREDENTIALS: SigaaCredentials = { login: "12345678900", senha: "segredo", syncMode: "cloud" };

describe("sigaa-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when nothing is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns the parsed credentials when stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(CREDENTIALS));

    await expect(getSigaaCredentials()).resolves.toEqual(CREDENTIALS);
  });

  it("returns null when the stored value is corrupted JSON", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("not-json");

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns null when SecureStore.getItemAsync rejects", async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error("Keystore decryption failed"));

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns null when the stored value is valid JSON but not credentials-shaped", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("{}");

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("saves the credentials as JSON under the sigaa key", async () => {
    await saveSigaaCredentials(CREDENTIALS);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.sigaa",
      JSON.stringify(CREDENTIALS),
    );
  });

  it("clears the stored credentials", async () => {
    await clearSigaaCredentials();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("gradline.sigaa");
  });
});
