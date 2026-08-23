import * as SecureStore from "expo-secure-store";

import {
  clearSigaaCredentials,
  forgetSigaaWasLinked,
  getSigaaCredentials,
  hasEverLinkedSigaa,
  markSigaaPasswordStale,
  rememberSigaaWasLinked,
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
      "ufba.sigaa",
      JSON.stringify(CREDENTIALS),
    );
  });

  it("reads back a credential that was marked stale", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ ...CREDENTIALS, senhaDesatualizada: true }),
    );

    await expect(getSigaaCredentials()).resolves.toEqual({
      ...CREDENTIALS,
      senhaDesatualizada: true,
    });
  });

  it("still accepts a credential stored before the stale flag existed", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(CREDENTIALS));

    await expect(getSigaaCredentials()).resolves.toEqual(CREDENTIALS);
  });

  it("marks the stored password stale without touching the password itself", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(CREDENTIALS));

    await markSigaaPasswordStale(true);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.sigaa",
      JSON.stringify({ ...CREDENTIALS, senhaDesatualizada: true }),
    );
  });

  it("clears the stale mark when the password works again", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ ...CREDENTIALS, senhaDesatualizada: true }),
    );

    await markSigaaPasswordStale(false);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.sigaa",
      JSON.stringify({ ...CREDENTIALS, senhaDesatualizada: false }),
    );
  });

  it("does nothing when there is no stored credential to mark", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await markSigaaPasswordStale(true);

    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("clears the stored credentials", async () => {
    await clearSigaaCredentials();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("ufba.sigaa");
  });

  it("does not forget that the account was once linked when the credentials are cleared", async () => {
    await clearSigaaCredentials();

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalledWith("ufba.sigaa.jaVinculou");
  });

  it("reports no previous link on a fresh install", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(hasEverLinkedSigaa()).resolves.toBe(false);
  });

  it("remembers a link across an unlink, so onboarding never runs twice", async () => {
    await rememberSigaaWasLinked();

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith("ufba.sigaa.jaVinculou", "1");
  });

  it("reports a previous link once the mark is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("1");

    await expect(hasEverLinkedSigaa()).resolves.toBe(true);
  });

  it("forgets the previous link entirely, so a fresh sign-in sees onboarding again", async () => {
    await forgetSigaaWasLinked();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("ufba.sigaa.jaVinculou");
  });

  it("treats an unreadable keystore as no previous link rather than crashing", async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error("Keystore decryption failed"));

    await expect(hasEverLinkedSigaa()).resolves.toBe(false);
  });
});
