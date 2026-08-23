import * as SecureStore from "expo-secure-store";

const MOODLE_KEY = "gradline.moodle";
const EVER_LINKED_KEY = "gradline.moodle.jaVinculou";

export type MoodleSession = {
  wstoken: string;
  privatetoken?: string;
  siteUrl: string;
  userId: number;
};

function isMoodleSession(value: unknown): value is MoodleSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MoodleSession).wstoken === "string" &&
    typeof (value as MoodleSession).siteUrl === "string" &&
    typeof (value as MoodleSession).userId === "number"
  );
}

export async function getMoodleSession(): Promise<MoodleSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(MOODLE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isMoodleSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveMoodleSession(session: MoodleSession): Promise<void> {
  await SecureStore.setItemAsync(MOODLE_KEY, JSON.stringify(session));
}

export async function clearMoodleSession(): Promise<void> {
  await SecureStore.deleteItemAsync(MOODLE_KEY);
}

export async function rememberMoodleWasLinked(): Promise<void> {
  await SecureStore.setItemAsync(EVER_LINKED_KEY, "1");
}

export async function hasEverLinkedMoodle(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(EVER_LINKED_KEY)) === "1";
  } catch {
    return false;
  }
}
