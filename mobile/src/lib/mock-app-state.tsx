import { createContext, useContext, useMemo, type JSX, type PropsWithChildren } from "react";

type MockAppStateValue = {
  studentName: string;
};

const MockAppStateContext = createContext<MockAppStateValue | undefined>(undefined);

/**
 * Cross-screen mock state for the front-end-only UFBA screens that don't have a
 * real backend endpoint yet (student profile info). Intentionally NOT persisted —
 * this is mockup state, not real app state, so it resets whenever the app reloads.
 *
 * SIGAA link status/sync mode used to live here too; that's now real state served by
 * `SigaaLinkProvider` (see `sigaa-link-context.tsx`).
 */
export function MockAppStateProvider({ children }: PropsWithChildren): JSX.Element {
  const value = useMemo<MockAppStateValue>(() => ({ studentName: "Ana Carvalho" }), []);

  return <MockAppStateContext.Provider value={value}>{children}</MockAppStateContext.Provider>;
}

export function useMockAppState(): MockAppStateValue {
  const context = useContext(MockAppStateContext);
  if (!context) {
    throw new Error("useMockAppState must be used within a MockAppStateProvider");
  }
  return context;
}
