import * as SecureStore from "expo-secure-store";

/**
 * Two small pieces of update state, in the same SecureStore the theme
 * preference uses. Dismissal is stored as the *version* rather than a boolean
 * so it expires on its own: dismissing 1.1.0 says nothing about 1.2.0.
 */

const VERSAO_DISPENSADA_KEY = "ufba.update-dismissed";
const ULTIMA_CHECAGEM_KEY = "ufba.update-last-check";

/** The check runs at most once an hour — an update is never urgent to the minute. */
export const INTERVALO_CHECAGEM_MS = 60 * 60 * 1000;

export async function getVersaoDispensada(): Promise<string | null> {
  return SecureStore.getItemAsync(VERSAO_DISPENSADA_KEY);
}

export async function dispensarVersao(versao: string): Promise<void> {
  await SecureStore.setItemAsync(VERSAO_DISPENSADA_KEY, versao);
}

export async function getUltimaChecagem(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(ULTIMA_CHECAGEM_KEY);
  if (raw === null) {
    return null;
  }
  const instante = Number.parseInt(raw, 10);
  // Corrupted value reads as "never checked" — worst case is one extra request.
  return Number.isFinite(instante) ? instante : null;
}

export async function marcarChecagem(agora: number): Promise<void> {
  await SecureStore.setItemAsync(ULTIMA_CHECAGEM_KEY, String(agora));
}
