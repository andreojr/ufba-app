import * as SecureStore from "expo-secure-store";

import type { PeriodoLetivo } from "./types";

/**
 * Last academic term the app saw, kept so screens that never call `/schedule`
 * can still tell whether the term is over.
 *
 * Written by the home screen after a successful schedule fetch, read by the
 * Trajetória screen to decide whether to nudge a re-sync. Not secret — it lives
 * in SecureStore only because that is the app's one persistence mechanism.
 */
const PERIODO_KEY = "gradline.periodo";

function isPeriodoLetivo(value: unknown): value is PeriodoLetivo {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PeriodoLetivo).semestre === "string" &&
    typeof (value as PeriodoLetivo).inicio === "string" &&
    typeof (value as PeriodoLetivo).fim === "string"
  );
}

export async function getPeriodoCache(): Promise<PeriodoLetivo | null> {
  try {
    const raw = await SecureStore.getItemAsync(PERIODO_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isPeriodoLetivo(parsed) ? parsed : null;
  } catch {
    // A bad read degrades to "no cached date", which keeps the nudge quiet.
    // Never let a cache miss take a screen down.
    return null;
  }
}

export async function savePeriodoCache(periodo: PeriodoLetivo): Promise<void> {
  await SecureStore.setItemAsync(PERIODO_KEY, JSON.stringify(periodo));
}

/** Drops the cached term — part of erasing the student's data. */
export async function clearPeriodoCache(): Promise<void> {
  await SecureStore.deleteItemAsync(PERIODO_KEY);
}
