import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { ApiError } from "@/lib/api";
import { useSigaaLink } from "@/lib/sigaa-link-context";

import LinkAccountScreen from "@/app/link-account";

jest.mock("@/lib/sigaa-link-context");

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("uniwind", () => ({
  useCSSVariable: () => "#000000",
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mockToastShow = jest.fn();

jest.mock("heroui-native", () => {
  const { Text, TextInput, TouchableOpacity, View } = jest.requireActual("react-native");

  return {
    useToast: () => ({ toast: { show: mockToastShow } }),
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
    Button: Object.assign(
      ({ children, onPress, isDisabled, testID }: any) => (
        <TouchableOpacity onPress={onPress} disabled={isDisabled} testID={testID} accessibilityRole="button">
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </TouchableOpacity>
      ),
      { Label: ({ children }: any) => <Text>{children}</Text> },
    ),
    Spinner: () => <Text>loading</Text>,
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    TextField: ({ children }: any) => <>{children}</>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    Description: ({ children }: any) => <Text>{children}</Text>,
    FieldError: ({ children }: any) => <Text>{children}</Text>,
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
    Input: ({ value, onChangeText, placeholder, secureTextEntry }: any) => (
      <TextInput
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
      />
    ),
  };
});

const mockedUseSigaaLink = jest.mocked(useSigaaLink);

// A well-known valid CPF (passes the check-digit algorithm) used purely as test fixture data.
const VALID_CPF = "111.444.777-35";
const VALID_CPF_DIGITS = "11144477735";

async function fillForm(getByPlaceholderText: (text: string) => any, cpf: string, senha: string) {
  await act(async () => {
    fireEvent.changeText(getByPlaceholderText("000.000.000-00"), cpf);
  });
  await act(async () => {
    fireEvent.changeText(getByPlaceholderText("Sua senha do sistema"), senha);
  });
}

describe("LinkAccountScreen", () => {
  const link = jest.fn();
  const unlink = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link, unlink });
  });

  it("submits the unmasked CPF digits with syncMode device by default", async () => {
    link.mockResolvedValue(undefined);
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    expect(link).toHaveBeenCalledWith(VALID_CPF_DIGITS, "segredo", "device");
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
  });

  it("submits the mode chosen in the selector", async () => {
    link.mockResolvedValue(undefined);
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");
    await act(async () => {
      fireEvent.press(getByTestId("sync-option-device"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    expect(link).toHaveBeenCalledWith(VALID_CPF_DIGITS, "segredo", "device");
  });

  it("falls back to device when editing a link saved in a mode the selector no longer offers", async () => {
    link.mockResolvedValue(undefined);
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "cloud", link, unlink });
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");
    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    expect(link).toHaveBeenCalledWith(VALID_CPF_DIGITS, "segredo", "device");
  });

  it("shows 'Credenciais inválidas' when the backend responds 401", async () => {
    link.mockRejectedValue(new ApiError("Invalid credentials", 401));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "danger", label: "Credenciais inválidas", icon: expect.anything() }),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows a rate-limit toast when the backend responds 429", async () => {
    link.mockRejectedValue(new ApiError("Too many requests", 429));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "danger",
        label: "Muitas tentativas. Aguarde um momento e tente de novo.",
        icon: expect.anything(),
      }),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows a generic server-error toast for any other backend status", async () => {
    link.mockRejectedValue(new ApiError("Internal error", 500));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "danger",
        label: "Algo deu errado no servidor. Tente novamente.",
        icon: expect.anything(),
      }),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows a no-network toast when the request never reaches the backend", async () => {
    link.mockRejectedValue(new TypeError("Network request failed"));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "danger",
        label: "Não foi possível conectar ao servidor.",
        icon: expect.anything(),
      }),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not submit when the CPF is invalid", async () => {
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, "111.111.111-11", "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    expect(link).not.toHaveBeenCalled();
  });

  it("calls unlink when the user presses Desvincular conta", async () => {
    unlink.mockResolvedValue(undefined);
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link, unlink });
    const { getByTestId } = await render(<LinkAccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("link-unlink-button"));
    });

    expect(unlink).toHaveBeenCalled();
  });
});
