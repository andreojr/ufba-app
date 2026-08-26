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
  /** True enquanto uma checagem manual (verificarAgora) está em voo. */
  verificando: boolean;
  /**
   * Mesma checagem, mas ignora o intervalo de 1h — o gesto explícito de quem
   * foi em Perfil apertar "Verificar agora" é justamente o caso em que a
   * espera passiva de uma hora não faz sentido. Ainda grava o instante da
   * checagem, então a próxima automática (ao reabrir o app) volta a respeitar
   * o intervalo normalmente a partir daqui.
   */
  verificarAgora: () => Promise<void>;
}

export function useAppUpdate(): EstadoAtualizacao {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [dispensada, setDispensada] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  const checar = useCallback(async (ignorarIntervalo = false) => {
    const ultima = await getUltimaChecagem();
    const agora = Date.now();
    if (!ignorarIntervalo && ultima !== null && agora - ultima < INTERVALO_CHECAGEM_MS) {
      return;
    }
    setDispensada(await getVersaoDispensada());
    const publicado = await getAppVersion();
    setRelease(publicado);
    await marcarChecagem(agora);
  }, []);

  const verificarAgora = useCallback(async () => {
    setVerificando(true);
    try {
      // Mesmo comportamento em falha da checagem automática (ver o efeito
      // abaixo): offline, timeout, ou nada publicado — sem toast, `release`
      // simplesmente não muda. A diferença aqui é só ignorar o intervalo.
      await checar(true).catch(() => undefined);
    } finally {
      setVerificando(false);
    }
  }, [checar]);

  useEffect(() => {
    // Every failure path ends here: offline, timeout, 404 (nothing published),
    // malformed body. The screen simply never learns about an update, which is
    // the designed behaviour — a broken check must not surface to the user.
    //
    // The rule below flags setState reached from an effect body because that
    // causes cascading renders. It cannot see through the async boundary:
    // `checar` always awaits SecureStore before it ever calls setState, so no
    // state update happens in the same tick as this effect, and no cascade is
    // possible. Narrowly disabled rather than restructured — deferring the call
    // through a timer only to satisfy the analysis would make the code worse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return { versaoInstalada: VERSAO_INSTALADA, release, temAtualizacao, dispensar, verificando, verificarAgora };
}
