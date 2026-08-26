import * as SecureStore from "expo-secure-store";

export type ThemePreference = "light" | "dark" | "system";

const THEME_PREFERENCE_KEY = "ufba.theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Defaults to "system" — the app follows the device's color scheme by
 * default, with light/dark available as an opt-in override from Ajustes.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
  return isThemePreference(raw) ? raw : "system";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
}
