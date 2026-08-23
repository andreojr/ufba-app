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

import { startMoodleLogin, type MoodleLoginResult } from "./moodle-auth";
import { getSiteInfo, onMoodleTokenVerdict } from "./moodle-api";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

type MoodleLinkState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "linked"; session: MoodleSession; expired: boolean };

type MoodleLinkContextValue = MoodleLinkState & {
  link: () => Promise<MoodleLoginResult>;
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

  const link = useCallback(async (): Promise<MoodleLoginResult> => {
    const result = await startMoodleLogin((wstoken, siteUrl) =>
      getSiteInfo({ wstoken, siteUrl, userId: 0 }).then((info) => info.userId),
    );
    if (result.status === "success") {
      await saveMoodleSession(result.session);
      void Promise.resolve(rememberMoodleWasLinked()).catch((error: unknown) => {
        console.warn("Failed to record Moodle link", error);
      });
      setState({ status: "linked", session: result.session, expired: false });
    }
    return result;
  }, []);

  const unlink = useCallback(async () => {
    await clearMoodleSession();
    setState({ status: "unlinked" });
  }, []);

  const value = useMemo<MoodleLinkContextValue>(
    () => ({ ...state, link, unlink }),
    [state, link, unlink],
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
