import * as SecureStore from "expo-secure-store";

import {
  clearMoodleSession,
  getMoodleSession,
  hasEverLinkedMoodle,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

jest.mock("expo-secure-store");

const mockStore = SecureStore as jest.Mocked<typeof SecureStore>;

const validSession: MoodleSession = {
  wstoken: "abc123",
  siteUrl: "https://ava.ufba.br",
  userId: 42,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("moodle-storage", () => {
  it("returns the parsed session when storage holds a valid one", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(validSession));
    await expect(getMoodleSession()).resolves.toEqual(validSession);
  });

  it("returns null when storage is empty", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("returns null when the stored JSON is corrupt", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce("{not json");
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("returns null when the stored object is missing required fields", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({ wstoken: "x" }));
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("persists the session as JSON under the moodle key", async () => {
    await saveMoodleSession(validSession);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.moodle",
      JSON.stringify(validSession),
    );
  });

  it("clears the session", async () => {
    await clearMoodleSession();
    expect(mockStore.deleteItemAsync).toHaveBeenCalledWith("gradline.moodle");
  });

  it("remembers and reports that the account was ever linked", async () => {
    await rememberMoodleWasLinked();
    expect(mockStore.setItemAsync).toHaveBeenCalledWith("gradline.moodle.jaVinculou", "1");

    mockStore.getItemAsync.mockResolvedValueOnce("1");
    await expect(hasEverLinkedMoodle()).resolves.toBe(true);
  });

  it("reports not-ever-linked when the flag is absent", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(hasEverLinkedMoodle()).resolves.toBe(false);
  });
});
