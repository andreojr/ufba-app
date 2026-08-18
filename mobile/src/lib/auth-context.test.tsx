import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import * as api from "./api";
import { AuthProvider, useAuth } from "./auth-context";
import * as sessionStorage from "./session-storage";
import type { Session } from "./types";

jest.mock("./api");
jest.mock("./session-storage");

const mockedApi = jest.mocked(api);
const mockedSessionStorage = jest.mocked(sessionStorage);

const SESSION: Session = {
  accessToken: "token",
  user: { googleId: "1", email: "a@b.com", name: "A" },
};

function wrapper({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthProvider / useAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts loading, then signedOut when there is no stored session", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(null);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedOut"));
  });

  it("starts in loading before the stored session resolves", async () => {
    let resolveSession: (value: Session | null) => void;
    mockedSessionStorage.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      })
    );

    const { result } = await renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe("loading");

    await act(async () => {
      resolveSession(null);
    });
    await waitFor(() => expect(result.current.status).toBe("signedOut"));
  });

  it("restores a signedIn state from a stored session", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedIn"));
    expect(result.current).toMatchObject(SESSION);
  });

  it("signIn calls the API, persists the session, and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(null);
    mockedApi.postGoogleLogin.mockResolvedValue(SESSION);

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedOut"));

    await act(async () => {
      await result.current.signIn("id-token");
    });

    expect(mockedApi.postGoogleLogin).toHaveBeenCalledWith("id-token");
    expect(mockedSessionStorage.saveSession).toHaveBeenCalledWith(SESSION);
    expect(result.current.status).toBe("signedIn");
  });

  it("signOut clears the session and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedIn"));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockedSessionStorage.clearSession).toHaveBeenCalled();
    expect(result.current.status).toBe("signedOut");
  });

  it("throws when useAuth is called outside AuthProvider", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(renderHook(() => useAuth())).rejects.toThrow(
      "useAuth must be used within an AuthProvider"
    );

    consoleError.mockRestore();
  });
});
