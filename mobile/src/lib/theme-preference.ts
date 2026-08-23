import * as SecureStore from "expo-secure-store";

export type ThemePreference = "light" | "dark" | "system";

const THEME_PREFERENCE_KEY = "ufba.theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Defaults to "light" — the app opens light by default (institutional look),
 * with dark/system available as an opt-in from Ajustes — rather than
 * following the device's color scheme like before the UFBA rebrand.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const raw = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY);
  return isThemePreference(raw) ? raw : "light";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference);
}
