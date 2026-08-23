import * as SecureStore from "expo-secure-store";

import type { SigaaCredentials } from "./types";

const SIGAA_KEY = "gradline.sigaa";
/**
 * Survives `clearSigaaCredentials` on purpose. Unlinking is not the same as
 * never having linked: the student's schedule and histórico stay in our own
 * database either way, so they should keep reading them — only *updating*
 * needs the password back. This flag is what tells the onboarding redirect
 * apart from "this person already used the app".
 */
const EVER_LINKED_KEY = "gradline.sigaa.jaVinculou";

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

/**
 * Flips the "SIGAA said no to this password" mark on the stored credential,
 * leaving the login and password themselves alone. Persisted (rather than kept
 * in memory) so the warning is still there after the app is closed and
 * reopened — the whole point is that the student walks into Perfil later and
 * finds it waiting.
 */
export async function markSigaaPasswordStale(stale: boolean): Promise<void> {
  const stored = await getSigaaCredentials();
  if (!stored) {
    return;
  }

  await saveSigaaCredentials({ ...stored, senhaDesatualizada: stale });
}

/** Records that the account was linked at least once on this device. */
export async function rememberSigaaWasLinked(): Promise<void> {
  await SecureStore.setItemAsync(EVER_LINKED_KEY, "1");
}

/** Whether this device ever completed a SIGAA link — see EVER_LINKED_KEY. */
export async function hasEverLinkedSigaa(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(EVER_LINKED_KEY)) === "1";
  } catch {
    return false;
  }
}

/**
 * Forgets that this device ever linked. Used only when the student erases their
 * account server-side: without this they would sign in again, be "unlinked but
 * already onboarded", and land on empty tabs with no prompt to link.
 */
export async function forgetSigaaWasLinked(): Promise<void> {
  await SecureStore.deleteItemAsync(EVER_LINKED_KEY);
}

export async function clearSigaaCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(SIGAA_KEY);
}
