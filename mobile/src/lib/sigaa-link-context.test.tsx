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

describe("SigaaLinkProvider / useSigaaLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
