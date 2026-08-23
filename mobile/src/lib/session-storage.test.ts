import * as SecureStore from "expo-secure-store";

import { clearSession, getSession, saveSession } from "./session-storage";
import type { Session } from "./types";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

const SESSION: Session = {
  accessToken: "token",
  user: { id: "1", email: "a@b.com", name: "A", avatarUrl: null },
};

describe("session-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when nothing is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns the parsed session when one is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(SESSION));

    await expect(getSession()).resolves.toEqual(SESSION);
  });

  it("returns null when the stored value is corrupted JSON", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("not-json");

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when SecureStore.getItemAsync rejects", async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error("Keystore decryption failed"));

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when the stored value is valid JSON but not session-shaped (number)", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("5");

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns null when the stored value is valid JSON but not session-shaped (empty object)", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("{}");

    await expect(getSession()).resolves.toBeNull();
  });

  it("saves the session as JSON under the session key", async () => {
    await saveSession(SESSION);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.session",
      JSON.stringify(SESSION),
    );
  });

  it("clears the stored session", async () => {
    await clearSession();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("ufba.session");
  });
});
