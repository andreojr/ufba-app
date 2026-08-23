import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { getAppVersion } from "./api";
import { haAtualizacao } from "./app-version";
import {
  dispensarVersao,
  getUltimaChecagem,
  getVersaoDispensada,
  INTERVALO_CHECAGEM_MS,
  marcarChecagem,
} from "./app-update-storage";
import type { AppRelease } from "./types";

/**
 * `expo-constants` rather than `expo-application`: the latter reads the version
 * off the installed binary, which is strictly more correct, but it is a native
 * module and — with no OTA in this architecture — the embedded manifest and the
 * binary can never disagree.
 */
const VERSAO_INSTALADA = Constants.expoConfig?.version ?? "0.0.0";

export interface EstadoAtualizacao {
  versaoInstalada: string;
  /** Null while the check has not succeeded — offline, throttled, or nothing published. */
  release: AppRelease | null;
  /** Already discounts a dismissal of this exact version. */
  temAtualizacao: boolean;
  dispensar: () => void;
}

export function useAppUpdate(): EstadoAtualizacao {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [dispensada, setDispensada] = useState<string | null>(null);

  const checar = useCallback(async () => {
    const ultima = await getUltimaChecagem();
    const agora = Date.now();
    if (ultima !== null && agora - ultima < INTERVALO_CHECAGEM_MS) {
      return;
    }
    setDispensada(await getVersaoDispensada());
    const publicado = await getAppVersion();
    setRelease(publicado);
    await marcarChecagem(agora);
  }, []);

  useEffect(() => {
    // Every failure path ends here: offline, timeout, 404 (nothing published),
    // malformed body. The screen simply never learns about an update, which is
    // the designed behaviour — a broken check must not surface to the user.
    void checar().catch(() => undefined);

    const subscription = AppState.addEventListener("change", (estado) => {
      if (estado === "active") {
        void checar().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [checar]);

  const dispensar = useCallback(() => {
    if (!release) {
      return;
    }
    setDispensada(release.latestVersion);
    void dispensarVersao(release.latestVersion).catch(() => undefined);
  }, [release]);

  const temAtualizacao =
    release !== null &&
    haAtualizacao(VERSAO_INSTALADA, release.latestVersion) &&
    dispensada !== release.latestVersion;

  return { versaoInstalada: VERSAO_INSTALADA, release, temAtualizacao, dispensar };
}
