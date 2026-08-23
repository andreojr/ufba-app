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

import { getSigaaLink, onSigaaCredentialsVerdict, postSigaaLink } from "./api";
import { useAuth } from "./auth-context";
import {
  clearSigaaCredentials,
  getSigaaCredentials,
  hasEverLinkedSigaa,
  markSigaaPasswordStale,
  rememberSigaaWasLinked,
  saveSigaaCredentials,
} from "./sigaa-storage";
import type { SyncMode } from "./types";

type SigaaLinkState =
  | { status: "loading" }
  | { status: "unlinked" }
  | {
      status: "linked";
      syncMode: SyncMode;
      /** SIGAA rejected the stored password — the student changed it there. */
      senhaDesatualizada: boolean;
    };

type SigaaLinkContextValue = SigaaLinkState & {
  /**
   * Whether this device ever completed a link. Read it to tell "brand-new
   * user, needs onboarding" apart from "unlinked now, but their schedule and
   * histórico are still in our database" — the second one must not be pushed
   * back through the onboarding flow.
   */
  jaVinculou: boolean;
  link: (login: string, senha: string, syncMode: SyncMode) => Promise<void>;
  unlink: () => Promise<void>;
};

const SigaaLinkContext = createContext<SigaaLinkContextValue | undefined>(undefined);

export function SigaaLinkProvider({ children }: PropsWithChildren): JSX.Element {
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [state, setState] = useState<SigaaLinkState>({ status: "loading" });
  const [jaVinculou, setJaVinculou] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function restore(token: string): Promise<void> {
      // Read before any setState below: the onboarding redirect fires the
      // moment the status turns "unlinked", and it needs this answer already
      // settled or it would bounce a returning user through onboarding.
      const everLinked = await hasEverLinkedSigaa();
      if (isMounted && everLinked) setJaVinculou(true);

      const local = await getSigaaCredentials();
      if (local) {
        // Backfill for anyone who was already linked when this flag shipped:
        // their credential is proof enough that onboarding is behind them.
        if (!everLinked) {
          setJaVinculou(true);
          void rememberSigaaWasLinked().catch((error: unknown) => {
            console.warn("Failed to backfill the SIGAA link mark", error);
          });
        }
        if (isMounted)
          setState({
            status: "linked",
            syncMode: local.syncMode,
            senhaDesatualizada: local.senhaDesatualizada === true,
          });
        return;
      }

      try {
        const remote = await getSigaaLink(token);
        if (remote.linked) {
          await saveSigaaCredentials({ login: remote.login, senha: remote.senha, syncMode: "cloud" });
          if (isMounted) setState({ status: "linked", syncMode: "cloud", senhaDesatualizada: false });
        } else if (isMounted) {
          setState({ status: "unlinked" });
        }
      } catch (error) {
        console.warn("Failed to restore SIGAA link", error);
        if (isMounted) setState({ status: "unlinked" });
      }
    }

    restore(accessToken);

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  // One subscription for the whole app: every screen that talks to SIGAA can be
  // the one that discovers the password no longer works, and each already shows
  // its own message. The request layer reports the verdict, and this is the only
  // place that has to remember what it means.
  useEffect(() => {
    return onSigaaCredentialsVerdict((verdict) => {
      const senhaDesatualizada = verdict === "rejected";
      setState((current) => {
        if (current.status !== "linked" || current.senhaDesatualizada === senhaDesatualizada) {
          return current;
        }

        void markSigaaPasswordStale(senhaDesatualizada);
        return { ...current, senhaDesatualizada };
      });
    });
  }, []);

  const link = useCallback(
    async (login: string, senha: string, syncMode: SyncMode) => {
      if (!accessToken) {
        throw new Error("Cannot link SIGAA credentials while signed out");
      }
      await postSigaaLink(accessToken, { login, senha }, syncMode === "cloud");

      try {
        // A successful POST /sigaa/link is SIGAA itself vouching for this
        // password, so whatever stale mark was there is gone.
        await saveSigaaCredentials({ login, senha, syncMode, senhaDesatualizada: false });
      } catch (error) {
        // Backend already validated/persisted per rememberPassword; a local
        // caching failure just means this device may re-prompt later.
        console.warn("Failed to cache SIGAA credentials locally", error);
      }

      setJaVinculou(true);
      // Deliberately not awaited alongside the credential write: failing to
      // record this only means onboarding might run once more, which is a far
      // smaller problem than failing the link the user just completed.
      void rememberSigaaWasLinked().catch((error: unknown) => {
        console.warn("Failed to record that SIGAA was linked", error);
      });

      setState({ status: "linked", syncMode, senhaDesatualizada: false });
    },
    [accessToken],
  );

  const unlink = useCallback(async () => {
    await clearSigaaCredentials();
    setState({ status: "unlinked" });
  }, []);

  const value = useMemo<SigaaLinkContextValue>(
    () => ({ ...state, jaVinculou, link, unlink }),
    [state, jaVinculou, link, unlink],
  );

  return <SigaaLinkContext.Provider value={value}>{children}</SigaaLinkContext.Provider>;
}

export function useSigaaLink(): SigaaLinkContextValue {
  const context = useContext(SigaaLinkContext);
  if (!context) {
    throw new Error("useSigaaLink must be used within a SigaaLinkProvider");
  }
  return context;
}
