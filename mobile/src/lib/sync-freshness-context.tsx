import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type JSX,
  type PropsWithChildren,
  type SetStateAction,
} from "react";

/**
 * When the horário and the histórico were each last fetched (a cache read or
 * a live sync, either counts), shared across every screen that reports on it
 * — Início's "Atualizado há X" badge and Perfil's sync item both read the
 * same two timestamps, instead of Perfil keeping its own copy that resets
 * every time the student navigates back to it (it's a pushed Stack screen,
 * not one of the four tabs that stay mounted — see TabsPager's docstring).
 *
 * Neither document has anything to do with the other on the SIGAA side, so
 * they're tracked separately rather than as one "last synced" instant —
 * `perfilFreshness` below is what collapses them into the single honest
 * answer to "how stale is my data" for anything that wants just one number.
 */
interface SyncFreshnessContextValue {
  scheduleFetchedAt: Date | null;
  historicoFetchedAt: Date | null;
  setScheduleFetchedAt: Dispatch<SetStateAction<Date | null>>;
  setHistoricoFetchedAt: Dispatch<SetStateAction<Date | null>>;
}

const SyncFreshnessContext = createContext<SyncFreshnessContextValue | undefined>(undefined);

export function SyncFreshnessProvider({ children }: PropsWithChildren): JSX.Element {
  const [scheduleFetchedAt, setScheduleFetchedAt] = useState<Date | null>(null);
  const [historicoFetchedAt, setHistoricoFetchedAt] = useState<Date | null>(null);
  const value = useMemo<SyncFreshnessContextValue>(
    () => ({ scheduleFetchedAt, historicoFetchedAt, setScheduleFetchedAt, setHistoricoFetchedAt }),
    [scheduleFetchedAt, historicoFetchedAt],
  );

  return <SyncFreshnessContext.Provider value={value}>{children}</SyncFreshnessContext.Provider>;
}

export function useSyncFreshness(): SyncFreshnessContextValue {
  const context = useContext(SyncFreshnessContext);
  if (!context) {
    throw new Error("useSyncFreshness must be used within a SyncFreshnessProvider");
  }
  return context;
}

/**
 * The older of the two — the honest answer to "how stale is my data", since a
 * sync that only refreshed one of them still leaves the other at its
 * previous age. Null only while neither has ever been fetched.
 */
export function perfilFreshness(scheduleFetchedAt: Date | null, historicoFetchedAt: Date | null): Date | null {
  if (scheduleFetchedAt && historicoFetchedAt) {
    return scheduleFetchedAt < historicoFetchedAt ? scheduleFetchedAt : historicoFetchedAt;
  }
  return scheduleFetchedAt ?? historicoFetchedAt;
}
