import * as SecureStore from "expo-secure-store";

import type { SigaaCredentials } from "./types";

const SIGAA_KEY = "gradline.sigaa";

function isSigaaCredentials(value: unknown): value is SigaaCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SigaaCredentials).login === "string" &&
    typeof (value as SigaaCredentials).senha === "string" &&
    ((value as SigaaCredentials).syncMode === "device" ||
      (value as SigaaCredentials).syncMode === "cloud")
  );
}

export async function getSigaaCredentials(): Promise<SigaaCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(SIGAA_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return isSigaaCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSigaaCredentials(credentials: SigaaCredentials): Promise<void> {
  await SecureStore.setItemAsync(SIGAA_KEY, JSON.stringify(credentials));
}

export async function clearSigaaCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(SIGAA_KEY);
}
