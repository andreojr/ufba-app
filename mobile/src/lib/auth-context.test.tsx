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
  user: { id: "1", email: "a@b.com", name: "A", avatarUrl: null },
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

  it("updateAvatarUrl saves the new avatar via the API, persists the session, and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);
    mockedApi.postAvatar.mockResolvedValue({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" });

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedIn"));

    await act(async () => {
      await result.current.updateAvatarUrl("https://api.dicebear.com/9.x/open-peeps/png?seed=abc");
    });

    expect(mockedApi.postAvatar).toHaveBeenCalledWith(
      "token",
      "https://api.dicebear.com/9.x/open-peeps/png?seed=abc"
    );
    const updatedSession: Session = {
      ...SESSION,
      user: { ...SESSION.user, avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" },
    };
    expect(mockedSessionStorage.saveSession).toHaveBeenCalledWith(updatedSession);
    expect(result.current).toMatchObject(updatedSession);
  });

  it("refreshUser fetches the latest user record, persists it, and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);
    const refreshedUser = {
      ...SESSION.user,
      matricula: "223116037",
      curso: "ENGENHARIA DE COMPUTAÇÃO",
      periodoIngresso: "2022.1",
    };
    mockedApi.getMe.mockResolvedValue(refreshedUser);

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedIn"));

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(mockedApi.getMe).toHaveBeenCalledWith("token");
    const updatedSession: Session = { accessToken: "token", user: refreshedUser };
    expect(mockedSessionStorage.saveSession).toHaveBeenCalledWith(updatedSession);
    expect(result.current).toMatchObject(updatedSession);
  });

  it("refreshUser swallows API failures and keeps the current state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);
    mockedApi.getMe.mockRejectedValue(new Error("offline"));

    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedIn"));

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(mockedSessionStorage.saveSession).not.toHaveBeenCalled();
    expect(result.current).toMatchObject(SESSION);
  });

  it("throws when useAuth is called outside AuthProvider", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(renderHook(() => useAuth())).rejects.toThrow(
      "useAuth must be used within an AuthProvider"
    );

    consoleError.mockRestore();
  });
});
