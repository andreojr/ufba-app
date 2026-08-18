import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { useAuth } from "@/lib/auth-context";

import LoginScreen from "@/app/login";

jest.mock("@/lib/auth-context");

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: {
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  },
  isSuccessResponse: (response: unknown) =>
    (response as { type?: string })?.type === "success",
  isErrorWithCode: (error: unknown) =>
    (error instanceof Error || (typeof error === "object" && error !== null)) &&
    "code" in (error as object),
  statusCodes: { SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED" },
}));

const mockToastShow = jest.fn();

jest.mock("heroui-native", () => {
  const { Text, TouchableOpacity } = jest.requireActual("react-native");

  return {
    useToast: () => ({ toast: { show: mockToastShow } }),
    Button: ({ children, onPress, isDisabled }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <Text>loading</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
    },
  };
});

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
});
