import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type PropsWithChildren,
} from "react";

import { router } from "expo-router";

import { onMoodleTokenVerdict } from "./moodle-api";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

export class MoodleSaveFailedError extends Error {
  constructor() {
    super("Não foi possível salvar a sessão do Moodle");
    this.name = "MoodleSaveFailedError";
  }
}

type MoodleLinkState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "linked"; session: MoodleSession; expired: boolean };

type MoodleLinkContextValue = MoodleLinkState & {
  /**
   * Opens the Moodle SSO. It navigates to an in-app WebView screen rather than
   * the system browser: the SSO redirect comes back on our own app scheme
   * (`ufba-app://token=...`), and the system browser would let that deep link
   * hit Expo Router (→ "Unmatched Route"). The WebView intercepts it instead.
   * The screen calls `finishLink` once it captures and validates the token.
   */
  link: () => void;
  /** Persists a validated session and flips state to linked. Throws MoodleSaveFailedError if the local save fails. */
  finishLink: (session: MoodleSession) => Promise<void>;
  unlink: () => Promise<void>;
};

const MoodleLinkContext = createContext<MoodleLinkContextValue | undefined>(undefined);

export function MoodleLinkProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<MoodleLinkState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    void getMoodleSession().then((session) => {
      if (!mounted) return;
      setState(session ? { status: "linked", session, expired: false } : { status: "unlinked" });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return onMoodleTokenVerdict((verdict) => {
      setState((current) =>
        current.status === "linked"
          ? { ...current, expired: verdict === "expired" }
          : current,
      );
    });
  }, []);

  const link = useCallback(() => {
    router.push("/moodle-webview");
  }, []);

  const finishLink = useCallback(async (session: MoodleSession) => {
    try {
      await saveMoodleSession(session);
    } catch (error) {
      // Spec: falha ao salvar a sessão localmente após captura vira
      // console.warn e o app trata como não vinculado — não afirmamos um link
      // que não foi persistido. A tela WebView traduz isso num toast.
      console.warn("Failed to save Moodle session locally", error);
      throw new MoodleSaveFailedError();
    }
    void rememberMoodleWasLinked().catch((error: unknown) => {
      console.warn("Failed to record Moodle link", error);
    });
    setState({ status: "linked", session, expired: false });
  }, []);

  const unlink = useCallback(async () => {
    await clearMoodleSession();
    setState({ status: "unlinked" });
  }, []);

  const value = useMemo<MoodleLinkContextValue>(
    () => ({ ...state, link, finishLink, unlink }),
    [state, link, finishLink, unlink],
  );

  return <MoodleLinkContext.Provider value={value}>{children}</MoodleLinkContext.Provider>;
}

export function useMoodleLink(): MoodleLinkContextValue {
  const context = useContext(MoodleLinkContext);
  if (!context) {
    throw new Error("useMoodleLink must be used within a MoodleLinkProvider");
  }
  return context;
}
