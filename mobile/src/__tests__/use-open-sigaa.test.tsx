import { act, renderHook } from "@testing-library/react-native";

import { ApiError, postSigaaSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useOpenSigaa } from "@/lib/use-open-sigaa";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  postSigaaSession: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockToastShow = jest.fn();
jest.mock("heroui-native", () => ({
  useThemeColor: () => "#000000",
  useToast: () => ({ toast: { show: mockToastShow } }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedPostSigaaSession = jest.mocked(postSigaaSession);

describe("useOpenSigaa", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
    } as any);
    mockPush.mockClear();
    mockToastShow.mockClear();
    mockedPostSigaaSession.mockClear();
  });

  it("opens the SIGAA WebView with the session cookie once linked", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", senhaDesatualizada: false, jaVinculou: true, link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedPostSigaaSession.mockResolvedValue({
      sessionCookie: "JSESSIONID=abc123.sigaapl06",
      targetUrl: "https://sigaa.ufba.br/sigaa/portais/discente/discente.jsf",
    });

    const { result } = await renderHook(() => useOpenSigaa());
    await act(async () => {
      await result.current.openSigaa();
    });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/sigaa-webview",
      params: {
        sessionCookie: "JSESSIONID=abc123.sigaapl06",
        targetUrl: "https://sigaa.ufba.br/sigaa/portais/discente/discente.jsf",
      },
    });
  });

  it("sends the user to link-account instead of opening SIGAA when unlinked", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { result } = await renderHook(() => useOpenSigaa());
    await act(async () => {
      await result.current.openSigaa();
    });

    expect(mockPush).toHaveBeenCalledWith("/link-account");
    expect(mockedPostSigaaSession).not.toHaveBeenCalled();
  });

  it("shows a toast when opening SIGAA fails", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", senhaDesatualizada: false, jaVinculou: true, link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "wrong", syncMode: "device" });
    mockedPostSigaaSession.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { result } = await renderHook(() => useOpenSigaa());
    await act(async () => {
      await result.current.openSigaa();
    });

    expect(mockToastShow).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: "/sigaa-webview" }));
  });
});
