import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import ContadorFaltasScreen from "@/app/contador-faltas";
import { useAuth } from "@/lib/auth-context";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  putFaltas: jest.fn(),
}));

const mockVoltar = jest.fn();
let mockParams: Record<string, string> = { id: "turma-uuid", faltas: "2" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockVoltar, push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockToastShow = jest.fn();
jest.mock("heroui-native", () => {
  const { Text, TouchableOpacity, View } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress, isDisabled, testID }: any) => (
      <TouchableOpacity testID={testID} disabled={isDisabled} onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    useThemeColor: () => "#888888",
    useToast: () => ({ toast: { show: mockToastShow } }),
  };
});

const { putFaltas } = jest.requireMock("@/lib/api");
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// RTL v14 neste projeto não flusha o re-render sincronamente no press — sem o
// act assíncrono o estado lido logo depois ainda é o anterior.
async function pressionar(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("ContadorFaltasScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "turma-uuid", faltas: "2" };
    putFaltas.mockResolvedValue(undefined);
    mockedAuth.mockReturnValue({ status: "signedIn", accessToken: "token" } as ReturnType<
      typeof useAuth
    >);
  });

  it("abre já mostrando o total que veio da tela da turma", async () => {
    await render(<ContadorFaltasScreen />);

    expect(screen.getByTestId("contador-faltas-valor")).toHaveTextContent("2");
  });

  it("soma e subtrai um a cada toque", async () => {
    await render(<ContadorFaltasScreen />);

    await pressionar("contador-faltas-mais");
    expect(screen.getByTestId("contador-faltas-valor")).toHaveTextContent("3");

    await pressionar("contador-faltas-menos");
    await pressionar("contador-faltas-menos");
    expect(screen.getByTestId("contador-faltas-valor")).toHaveTextContent("1");
  });

  // Faltas negativas não existem, e o backend recusaria com 400 — o botão
  // desabilitado evita a viagem e a mensagem de erro.
  it("não deixa passar de zero pra baixo", async () => {
    mockParams = { id: "turma-uuid", faltas: "0" };
    await render(<ContadorFaltasScreen />);

    await pressionar("contador-faltas-menos");

    expect(screen.getByTestId("contador-faltas-valor")).toHaveTextContent("0");
  });

  // Um param ausente ou corrompido viraria NaN e quebraria a tela inteira.
  it("cai em zero quando o param de faltas não é um número", async () => {
    mockParams = { id: "turma-uuid", faltas: "abacaxi" };
    await render(<ContadorFaltasScreen />);

    expect(screen.getByTestId("contador-faltas-valor")).toHaveTextContent("0");
  });

  it("salva o total absoluto e volta pra tela da turma", async () => {
    await render(<ContadorFaltasScreen />);

    await pressionar("contador-faltas-mais");
    await act(async () => {
      fireEvent.press(screen.getByText("Salvar"));
    });

    await waitFor(() => expect(putFaltas).toHaveBeenCalledWith("token", "turma-uuid", 3));
    await waitFor(() => expect(mockVoltar).toHaveBeenCalled());
  });

  it("mostra o erro e permanece na tela quando salvar falha", async () => {
    putFaltas.mockRejectedValue(new Error("offline"));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<ContadorFaltasScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText("Salvar"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    expect(mockVoltar).not.toHaveBeenCalled();
  });

  it("fecha sem salvar pelo X", async () => {
    await render(<ContadorFaltasScreen />);

    await pressionar("contador-faltas-close");

    expect(putFaltas).not.toHaveBeenCalled();
    expect(mockVoltar).toHaveBeenCalled();
  });
});
