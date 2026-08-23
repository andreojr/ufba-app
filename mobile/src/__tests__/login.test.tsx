import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

import LoginScreen from "@/app/login";

jest.mock("@/lib/auth-context");

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
  isSuccessResponse: (response: unknown) =>
    (response as { type?: string })?.type === "success",
  isErrorWithCode: (error: unknown) =>
    (error instanceof Error || (typeof error === "object" && error !== null)) &&
    "code" in (error as object),
  statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED" },
}));

const mockToastShow = jest.fn();

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// @expo/vector-icons transitively requires expo-font -> expo-asset, which isn't
// hoisted to the root node_modules in this project's install layout. Stub it out
// for this unit test rather than exercising the real font-loading module graph.
jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  return {
    useToast: () => ({ toast: { show: mockToastShow } }),
    useThemeColor: () => "#A78BFA",
    Button: ({ children, onPress, isDisabled }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <Text>loading</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    // Minimal stand-in for the real compound Toast — dangerToast() (see
    // @/lib/toast-helpers) renders through this via the "custom component"
    // toast.show() pattern, so tests can render what was passed to it.
    Toast: Object.assign(({ children }: any) => <View>{children}</View>, {
      Title: ({ children }: any) => <Text testID="toast-title">{children}</Text>,
      Description: ({ children }: any) => <Text testID="toast-description">{children}</Text>,
    }),
  };
});

/** Renders the last toast.show() call's `component` (see @/lib/toast-helpers's
 * dangerToast) and returns its title/description text — the danger toast's
 * actual visible content, since it no longer passes a plain `{ variant, label }`
 * object. */
async function lastDangerToast(): Promise<{ label: string; description: string | null }> {
  const [options] = mockToastShow.mock.calls[mockToastShow.mock.calls.length - 1];
  const { getByTestId, queryByTestId } = await render(options.component({ id: "toast", hide: jest.fn() }));
  return {
    label: getByTestId("toast-title").props.children,
    description: queryByTestId("toast-description")?.props.children ?? null,
  };
}

const mockedUseAuth = jest.mocked(useAuth);
const mockedGoogleSignin = jest.mocked(GoogleSignin);

describe("LoginScreen", () => {
  const signIn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "signedOut",
      signIn,
      signOut: jest.fn(),
      updateAvatarUrl: jest.fn(),
      refreshUser: jest.fn(),
    });
    mockedGoogleSignin.hasPlayServices.mockResolvedValue(true);
  });

  it("does not call signIn or show a toast when the user cancels", async () => {
    mockedGoogleSignin.signIn.mockResolvedValue({ type: "cancelled" } as never);

    const { getByRole } = await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByRole("button"));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockedGoogleSignin.signIn).toHaveBeenCalled());

    expect(signIn).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("shows a toast when the success response has no idToken", async () => {
    mockedGoogleSignin.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: null },
    } as never);

    const { getByRole } = await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByRole("button"));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows a toast when GoogleSignin.signIn rejects with a non-cancel error", async () => {
    mockedGoogleSignin.signIn.mockRejectedValue(new Error("boom"));

    const { getByRole } = await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByRole("button"));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the UFBA domain toast and skips signIn when the Google account is outside @ufba.br", async () => {
    mockedGoogleSignin.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: "some-id-token", user: { email: "pessoa@gmail.com" } },
    } as never);

    const { getByRole } = await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByRole("button"));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect((await lastDangerToast()).description).toEqual(expect.stringContaining("@ufba.br"));
    expect(signIn).not.toHaveBeenCalled();
    expect(mockedGoogleSignin.signOut).toHaveBeenCalled();
  });

  it("shows the UFBA domain toast when the backend rejects the login with a 403", async () => {
    mockedGoogleSignin.signIn.mockResolvedValue({
      type: "success",
      data: { idToken: "some-id-token", user: { email: "aluno@ufba.br" } },
    } as never);
    signIn.mockRejectedValue(
      new ApiError("Apenas contas @ufba.br podem entrar no UFBA", 403),
    );

    const { getByRole } = await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(getByRole("button"));
      await Promise.resolve();
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect((await lastDangerToast()).description).toEqual(expect.stringContaining("@ufba.br"));
  });
});
