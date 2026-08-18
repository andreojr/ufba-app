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

import { postGoogleLogin } from "./api";
import { clearSession, getSession, saveSession } from "./session-storage";
import type { GoogleUserInfo } from "./types";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; accessToken: string; user: GoogleUserInfo };

type AuthContextValue = AuthState & {
  signIn: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
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

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut]
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
