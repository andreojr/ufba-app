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

import { getMe, postAvatar, postGoogleLogin } from "./api";
import { clearSession, getSession, saveSession } from "./session-storage";
import type { GoogleUserInfo } from "./types";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; accessToken: string; user: GoogleUserInfo };

type AuthContextValue = AuthState & {
  signIn: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateAvatarUrl: (avatarUrl: string) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    getSession().then((session) => {
      if (!isMounted) {
        return;
      }
      setState(session ? { status: "signedIn", ...session } : { status: "signedOut" });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async (idToken: string) => {
    const session = await postGoogleLogin(idToken);
    await saveSession(session);
    setState({ status: "signedIn", ...session });
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setState({ status: "signedOut" });
  }, []);

  const updateAvatarUrl = useCallback(
    async (avatarUrl: string) => {
      if (state.status !== "signedIn") {
        return;
      }

      await postAvatar(state.accessToken, avatarUrl);
      const session = { accessToken: state.accessToken, user: { ...state.user, avatarUrl } };
      await saveSession(session);
      setState({ status: "signedIn", ...session });
    },
    [state]
  );

  // The user record stored at login predates anything the backend captures
  // later (matrícula/curso/período de ingresso arrive on schedule fetches),
  // so screens showing those fields call this to sync up. Best-effort: a
  // failure (offline, backend down) just keeps whatever is already stored.
  const refreshUser = useCallback(async () => {
    if (state.status !== "signedIn") {
      return;
    }

    try {
      const user = await getMe(state.accessToken);
      const session = { accessToken: state.accessToken, user };
      await saveSession(session);
      setState({ status: "signedIn", ...session });
    } catch (error) {
      console.warn("Failed to refresh the user profile", error);
    }
  }, [state]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, updateAvatarUrl, refreshUser }),
    [state, signIn, signOut, updateAvatarUrl, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
