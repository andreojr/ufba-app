import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { syncAll } from "@/lib/sync-all";

import LinkAccountScreen from "@/app/link-account";

jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/auth-context");
jest.mock("@/lib/sync-all");

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("uniwind", () => ({
  useCSSVariable: () => "#000000",
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
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
 * dangerToast) and returns its title text — the danger toast's actual visible
 * content, since it no longer passes a plain `{ variant, label }` object. */
async function lastDangerToastText(): Promise<string> {
  const [options] = mockToastShow.mock.calls[mockToastShow.mock.calls.length - 1];
  const { getByTestId } = await render(options.component({ id: "toast", hide: jest.fn() }));
  return getByTestId("toast-title").props.children;
}

const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedUseAuth = jest.mocked(useAuth);
const mockedSyncAll = jest.mocked(syncAll);

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
    mockCanGoBack.mockReturnValue(false);
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link, unlink });
    // Sem token, o sync pós-vinculação (ver link-account.tsx) simplesmente
    // não dispara — cada teste que precisa dele configura accessToken.
    mockedUseAuth.mockReturnValue({ status: "signedOut" } as ReturnType<typeof useAuth>);
    mockedSyncAll.mockResolvedValue({
      horario: { status: "fulfilled", value: { sincronizado: false } },
      historico: { status: "fulfilled", value: { sincronizado: false } },
      docentes: null,
    });
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

  it("still submits device when editing a link that had been saved as cloud", async () => {
    link.mockResolvedValue(undefined);
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "cloud",
      senhaDesatualizada: false,
      jaVinculou: true,
      link,
      unlink,
    });
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");
    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    expect(link).toHaveBeenCalledWith(VALID_CPF_DIGITS, "segredo", "device");
  });

  it("tells the user plainly which password to type", async () => {
    // Dito uma vez, no parágrafo de abertura: o Description embaixo do campo
    // repetia a mesma informação a dois dedos de distância.
    const { getByText } = await render(<LinkAccountScreen />);

    expect(getByText(/mesmos dados que você usa no sistema da faculdade/i)).toBeTruthy();
  });

  it("confirms the link is healthy when the stored password still works", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      link,
      unlink,
    });

    const { getByText, queryByTestId } = await render(<LinkAccountScreen />);

    expect(getByText("Conta vinculada")).toBeTruthy();
    expect(queryByTestId("senha-desatualizada-aviso")).toBeNull();
  });

  it("explains what happened when SIGAA has already rejected the stored password", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: true,
      jaVinculou: true,
      link,
      unlink,
    });

    const { getByTestId, getByText, queryByText } = await render(<LinkAccountScreen />);

    expect(getByTestId("senha-desatualizada-aviso")).toBeTruthy();
    expect(getByText("Sua senha do SIGAA mudou")).toBeTruthy();
    expect(queryByText("Conta vinculada")).toBeNull();
  });

  it("promises the password never leaves the phone, with no place-to-store choice", async () => {
    const { getByTestId, queryByTestId, getByText } = await render(<LinkAccountScreen />);

    expect(getByTestId("password-stays-on-device")).toBeTruthy();
    expect(getByText("Sua senha nunca sai deste celular")).toBeTruthy();
    expect(getByText(/Fica no cofre do aparelho/i)).toBeTruthy();
    expect(getByText(/Não sobe para nenhum servidor/i)).toBeTruthy();
    expect(queryByTestId("sync-option-device")).toBeNull();
    expect(queryByTestId("sync-option-cloud")).toBeNull();
  });

  it("says what the server keeps and what it discards, alongside the password checks", async () => {
    // Veio do Perfil, onde só aparecia antes do primeiro sync do histórico:
    // é aqui que a pessoa decide entregar o acesso, então é aqui que a
    // resposta sobre CPF, RG e data de nascimento precisa estar.
    const { getByTestId, getByText } = await render(<LinkAccountScreen />);

    expect(getByTestId("password-stays-on-device")).toBeTruthy();
    expect(getByText("No servidor fica só o que é da faculdade")).toBeTruthy();
    expect(getByText(/O que fica guardado/i)).toBeTruthy();
    expect(getByText(/matérias, notas e carga horária/i)).toBeTruthy();
    expect(getByText(/O que não fica/i)).toBeTruthy();
    expect(getByText(/CPF, RG e data de nascimento/i)).toBeTruthy();
    expect(getByText(/apaga tudo com um toque, em Perfil/i)).toBeTruthy();
  });

  it("points at the open-source repo so the privacy claims can be checked, not just believed", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const { getByTestId, getByText } = await render(<LinkAccountScreen />);

    expect(getByText("Código aberto")).toBeTruthy();
    expect(getByText(/qualquer pessoa pode ler o que o código faz/i)).toBeTruthy();
    expect(getByText(/pode contribuir com o projeto/i)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("open-source-card"));
    });

    expect(openURL).toHaveBeenCalledWith(expect.stringContaining("github.com/"));
    openURL.mockRestore();
  });

  it("shows a back arrow that pops the screen when it was pushed (e.g. from Perfil)", async () => {
    mockCanGoBack.mockReturnValue(true);
    const { getByTestId } = await render(<LinkAccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("app-bar-back"));
    });

    expect(mockBack).toHaveBeenCalled();
  });

  it("hides the back arrow when the screen is the root of the stack (first login)", async () => {
    const { queryByTestId } = await render(<LinkAccountScreen />);

    expect(queryByTestId("app-bar-back")).toBeNull();
  });

  it("shows 'Credenciais inválidas' when the backend responds 401", async () => {
    link.mockRejectedValue(new ApiError("Invalid credentials", 401));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(await lastDangerToastText()).toBe("Credenciais inválidas");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("calls a mistyped password exactly that, not a password that changed", async () => {
    // Same tagged 401 that tells the rest of the app "the stored password went
    // stale" — but here the user typed it seconds ago, so "atualize em Perfil"
    // would be advice to fix the very form they are looking at.
    link.mockRejectedValue(new ApiError("nope", 401, "SIGAA_INVALID_CREDENTIALS"));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "errada");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(await lastDangerToastText()).toBe("Credenciais inválidas");
  });

  it("shows a rate-limit toast when the backend responds 429", async () => {
    link.mockRejectedValue(new ApiError("Too many requests", 429));
    const { getByTestId, getByPlaceholderText } = await render(<LinkAccountScreen />);

    await fillForm(getByPlaceholderText, VALID_CPF, "segredo");

    await act(async () => {
      fireEvent.press(getByTestId("link-submit-button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(await lastDangerToastText()).toBe("Muitas tentativas. Aguarde um momento e tente de novo.");
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
    expect(await lastDangerToastText()).toBe("Algo deu errado no servidor. Tente novamente.");
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
    expect(await lastDangerToastText()).toBe("Não foi possível conectar ao servidor.");
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
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      link,
      unlink,
    });
    const { getByTestId } = await render(<LinkAccountScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("link-unlink-button"));
    });

    expect(unlink).toHaveBeenCalled();
  });
});
