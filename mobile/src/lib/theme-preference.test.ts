import * as SecureStore from "expo-secure-store";

import { getThemePreference, saveThemePreference } from "./theme-preference";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

describe("theme-preference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("defaults to light when nothing is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getThemePreference()).resolves.toBe("light");
  });

  it("returns the stored preference", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("dark");

    await expect(getThemePreference()).resolves.toBe("dark");
  });

  it("defaults to light when the stored value is not a recognized preference", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("not-a-theme");

    await expect(getThemePreference()).resolves.toBe("light");
  });

  it("persists the preference", async () => {
    await saveThemePreference("system");

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith("gradline.theme-preference", "system");
  });
});
