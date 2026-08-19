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

import { getSigaaLink, postSigaaLink } from "./api";
import { useAuth } from "./auth-context";
import { clearSigaaCredentials, getSigaaCredentials, saveSigaaCredentials } from "./sigaa-storage";
import type { SyncMode } from "./types";

type SigaaLinkState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "linked"; syncMode: SyncMode };

type SigaaLinkContextValue = SigaaLinkState & {
  link: (login: string, senha: string, syncMode: SyncMode) => Promise<void>;
  unlink: () => Promise<void>;
};

const SigaaLinkContext = createContext<SigaaLinkContextValue | undefined>(undefined);

export function SigaaLinkProvider({ children }: PropsWithChildren): JSX.Element {
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [state, setState] = useState<SigaaLinkState>({ status: "loading" });

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function restore(token: string): Promise<void> {
      const local = await getSigaaCredentials();
      if (local) {
        if (isMounted) setState({ status: "linked", syncMode: local.syncMode });
        return;
      }

      try {
        const remote = await getSigaaLink(token);
        if (remote.linked) {
          await saveSigaaCredentials({ login: remote.login, senha: remote.senha, syncMode: "cloud" });
          if (isMounted) setState({ status: "linked", syncMode: "cloud" });
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

  const link = useCallback(
    async (login: string, senha: string, syncMode: SyncMode) => {
      if (!accessToken) {
        throw new Error("Cannot link SIGAA credentials while signed out");
      }
      await postSigaaLink(accessToken, { login, senha }, syncMode === "cloud");

      try {
        await saveSigaaCredentials({ login, senha, syncMode });
      } catch (error) {
        // Backend already validated/persisted per rememberPassword; a local
        // caching failure just means this device may re-prompt later.
        console.warn("Failed to cache SIGAA credentials locally", error);
      }

      setState({ status: "linked", syncMode });
    },
    [accessToken],
  );

  const unlink = useCallback(async () => {
    await clearSigaaCredentials();
    setState({ status: "unlinked" });
  }, []);

  const value = useMemo<SigaaLinkContextValue>(() => ({ ...state, link, unlink }), [state, link, unlink]);

  return <SigaaLinkContext.Provider value={value}>{children}</SigaaLinkContext.Provider>;
}

export function useSigaaLink(): SigaaLinkContextValue {
  const context = useContext(SigaaLinkContext);
  if (!context) {
    throw new Error("useSigaaLink must be used within a SigaaLinkProvider");
  }
  return context;
}
