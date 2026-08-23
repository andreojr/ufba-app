import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import * as api from "./api";
import { useAuth } from "./auth-context";
import { SigaaLinkProvider, useSigaaLink } from "./sigaa-link-context";
import * as sigaaStorage from "./sigaa-storage";

jest.mock("./api");
jest.mock("./auth-context");
jest.mock("./sigaa-storage");

const mockedApi = jest.mocked(api);
const mockedUseAuth = jest.mocked(useAuth);
const mockedSigaaStorage = jest.mocked(sigaaStorage);

const SIGNED_IN = {
  status: "signedIn" as const,
  accessToken: "token",
  user: { id: "1", email: "a@b.com", name: "A", avatarUrl: null },
  signIn: jest.fn(),
  signOut: jest.fn(),
  updateAvatarUrl: jest.fn(),
  refreshUser: jest.fn(),
};

function wrapper({ children }: PropsWithChildren) {
  return <SigaaLinkProvider>{children}</SigaaLinkProvider>;
}

/** Hands back the verdict listener the provider registered on mount. */
function subscribedListener(): (verdict: "accepted" | "rejected") => void {
  const [listener] = mockedApi.onSigaaCredentialsVerdict.mock.calls.at(-1) ?? [];
  if (!listener) {
    throw new Error("SigaaLinkProvider never subscribed to credential verdicts");
  }
  return listener;
}

const LINKED_CREDENTIAL = {
  login: "12345678900",
  senha: "segredo",
  syncMode: "device" as const,
};

describe("SigaaLinkProvider / useSigaaLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.onSigaaCredentialsVerdict.mockReturnValue(jest.fn());
    mockedSigaaStorage.hasEverLinkedSigaa.mockResolvedValue(false);
    mockedSigaaStorage.rememberSigaaWasLinked.mockResolvedValue(undefined);
  });

  it("reports no previous link on a fresh install, so onboarding can run", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    expect(result.current.jaVinculou).toBe(false);
  });

  it("knows the account was linked before by the time it reports unlinked", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedSigaaStorage.hasEverLinkedSigaa.mockResolvedValue(true);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    expect(result.current.jaVinculou).toBe(true);
  });

  it("link() records the link so a later unlink never sends the user back to onboarding", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("12345678900", "segredo", "device");
    });

    expect(mockedSigaaStorage.rememberSigaaWasLinked).toHaveBeenCalled();
    expect(result.current.jaVinculou).toBe(true);
  });

  it("still reports a previous link after unlink()", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);
    mockedSigaaStorage.hasEverLinkedSigaa.mockResolvedValue(true);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("linked"));

    await act(async () => {
      await result.current.unlink();
    });

    expect(result.current.status).toBe("unlinked");
    expect(result.current.jaVinculou).toBe(true);
  });

  it("starts out with the password considered current", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(result.current).toMatchObject({ senhaDesatualizada: false });
  });

  it("restores the stale mark left by an earlier session, so Perfil is already red on reopen", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue({
      ...LINKED_CREDENTIAL,
      senhaDesatualizada: true,
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(result.current).toMatchObject({ status: "linked", senhaDesatualizada: true });
  });

  it("backfills the link mark for someone already linked before the flag existed", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);
    mockedSigaaStorage.hasEverLinkedSigaa.mockResolvedValue(false);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(result.current.jaVinculou).toBe(true);
    expect(mockedSigaaStorage.rememberSigaaWasLinked).toHaveBeenCalled();
  });

  it("marks the password stale — and persists it — when any SIGAA call reports a rejection", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("linked"));

    await act(async () => {
      subscribedListener()("rejected");
    });

    expect(result.current).toMatchObject({ senhaDesatualizada: true });
    expect(mockedSigaaStorage.markSigaaPasswordStale).toHaveBeenCalledWith(true);
  });

  it("clears the stale mark when a later SIGAA call goes through", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue({
      ...LINKED_CREDENTIAL,
      senhaDesatualizada: true,
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ senhaDesatualizada: true }));

    await act(async () => {
      subscribedListener()("accepted");
    });

    expect(result.current).toMatchObject({ senhaDesatualizada: false });
    expect(mockedSigaaStorage.markSigaaPasswordStale).toHaveBeenCalledWith(false);
  });

  it("does not rewrite storage when the verdict only confirms what it already knew", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("linked"));

    await act(async () => {
      subscribedListener()("accepted");
    });

    expect(mockedSigaaStorage.markSigaaPasswordStale).not.toHaveBeenCalled();
  });

  it("unsubscribes from verdicts when it unmounts", async () => {
    const unsubscribe = jest.fn();
    mockedApi.onSigaaCredentialsVerdict.mockReturnValue(unsubscribe);
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(LINKED_CREDENTIAL);

    const { unmount } = await renderHook(() => useSigaaLink(), { wrapper });
    await act(async () => {
      unmount();
    });

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("stays loading while the user is signed out", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedOut",
      signIn: jest.fn(),
      signOut: jest.fn(),
      updateAvatarUrl: jest.fn(),
      refreshUser: jest.fn(),
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(mockedSigaaStorage.getSigaaCredentials).not.toHaveBeenCalled();
  });

  it("resolves to linked with the stored syncMode when a local credential exists", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue({
      login: "12345678900",
      senha: "segredo",
      syncMode: "device",
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(result.current).toMatchObject({ status: "linked", syncMode: "device" });
    expect(mockedApi.getSigaaLink).not.toHaveBeenCalled();
  });

  it("falls back to GET /sigaa/link and resolves to unlinked when nothing is stored anywhere", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    expect(mockedApi.getSigaaLink).toHaveBeenCalledWith("token");
    expect(mockedSigaaStorage.saveSigaaCredentials).not.toHaveBeenCalled();
  });

  it("restores a cloud-saved credential locally (as syncMode cloud) and resolves to linked", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({
      linked: true,
      login: "12345678900",
      senha: "segredo",
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(result.current).toMatchObject({ status: "linked", syncMode: "cloud" });
    expect(mockedSigaaStorage.saveSigaaCredentials).toHaveBeenCalledWith({
      login: "12345678900",
      senha: "segredo",
      syncMode: "cloud",
    });
  });

  it("resolves to unlinked when the restore network call fails", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockRejectedValue(new Error("network down"));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    consoleWarn.mockRestore();
  });

  it("link() posts the credentials, caches them locally, and sets status to linked", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("12345678900", "segredo", "cloud");
    });

    expect(mockedApi.postSigaaLink).toHaveBeenCalledWith(
      "token",
      { login: "12345678900", senha: "segredo" },
      true,
    );
    expect(mockedSigaaStorage.saveSigaaCredentials).toHaveBeenCalledWith({
      login: "12345678900",
      senha: "segredo",
      syncMode: "cloud",
      senhaDesatualizada: false,
    });
    expect(result.current).toMatchObject({ status: "linked", syncMode: "cloud" });
  });

  it("link() with syncMode device sends rememberPassword: false", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("12345678900", "segredo", "device");
    });

    expect(mockedApi.postSigaaLink).toHaveBeenCalledWith(
      "token",
      { login: "12345678900", senha: "segredo" },
      false,
    );
  });

  it("link() still resolves to linked when the backend succeeds but the local cache write fails", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);
    mockedSigaaStorage.saveSigaaCredentials.mockRejectedValue(new Error("keystore full"));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("12345678900", "segredo", "cloud");
    });

    expect(result.current.status).toBe("linked");
    consoleWarn.mockRestore();
  });

  it("link() propagates the error and stays unlinked when the backend rejects the credentials", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockRejectedValue(new Error("invalid credentials"));

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await expect(
      act(async () => {
        await result.current.link("12345678900", "wrong", "cloud");
      }),
    ).rejects.toThrow("invalid credentials");

    expect(result.current.status).toBe("unlinked");
  });

  it("link() clears the stale mark, since the new password just proved itself", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue({
      ...LINKED_CREDENTIAL,
      senhaDesatualizada: true,
    });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current).toMatchObject({ senhaDesatualizada: true }));

    await act(async () => {
      await result.current.link("12345678900", "nova", "device");
    });

    expect(result.current).toMatchObject({ status: "linked", senhaDesatualizada: false });
    expect(mockedSigaaStorage.saveSigaaCredentials).toHaveBeenCalledWith({
      login: "12345678900",
      senha: "nova",
      syncMode: "device",
      senhaDesatualizada: false,
    });
  });

  it("unlink() clears local storage and sets status to unlinked", async () => {
    mockedUseAuth.mockReturnValue(SIGNED_IN);
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue({
      login: "12345678900",
      senha: "segredo",
      syncMode: "device",
    });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("linked"));

    await act(async () => {
      await result.current.unlink();
    });

    expect(mockedSigaaStorage.clearSigaaCredentials).toHaveBeenCalled();
    expect(result.current.status).toBe("unlinked");
  });

  it("throws when useSigaaLink is called outside SigaaLinkProvider", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(renderHook(() => useSigaaLink())).rejects.toThrow(
      "useSigaaLink must be used within a SigaaLinkProvider",
    );

    consoleError.mockRestore();
  });
});
