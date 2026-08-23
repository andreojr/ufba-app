import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { getSchedule, postPontoAtencao } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Turma } from "@/lib/types";

import NovoPontoAtencaoScreen from "@/app/ponto-de-atencao/novo";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postPontoAtencao: jest.fn(),
}));

const mockBack = jest.fn();
let mockParams: { turmaId?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, TextInput, TouchableOpacity, View } = jest.requireActual("react-native");

  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
    Button: ({ children, onPress, isDisabled, testID }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} testID={testID} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <Text>loading</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    TextField: ({ children }: any) => <View>{children}</View>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    Description: ({ children }: any) => <Text>{children}</Text>,
    FieldError: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    Input: ({ testID, value, onChangeText, placeholder, keyboardType, maxLength }: any) => (
      <TextInput
        testID={testID}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
    ),
  };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedPostPontoAtencao = jest.mocked(postPontoAtencao);

function turmaFalsa(overrides: Partial<Turma> = {}): Turma {
  return {
    id: "turma-1",
    numero: "01",
    codigo: "ENGG64",
    nome: "CÁLCULO NUMÉRICO",
    docente: null,
    slots: [],
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
    ...overrides,
  };
}

async function renderNovo({
  turmaId,
  turmas = [turmaFalsa()],
}: {
  turmaId?: string;
  turmas?: Turma[];
}) {
  mockParams = turmaId !== undefined ? { turmaId } : {};
  mockedUseAuth.mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
  } as any);
  mockedGetSchedule.mockResolvedValue({
    turmas,
    periodoLetivo: null,
    fetchedAt: "2026-08-24T10:00:00.000Z",
  });

  const utils = await render(<NovoPontoAtencaoScreen />);
  return utils;
}

describe("PontoAtencaoForm (rota novo)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("esconde o seletor quando a turma vem na rota", async () => {
    const { queryByTestId } = await renderNovo({ turmaId: "turma-1" });

    expect(queryByTestId("seletor-turma")).toBeNull();
  });

  it("mostra o seletor com as turmas do semestre quando não vem turma", async () => {
    const { getByTestId } = await renderNovo({});

    await waitFor(() => expect(mockedGetSchedule).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId("seletor-turma")).toHaveTextContent("ENGG64", { exact: false }),
    );
  });

  it("envia tipo, título e data ao salvar", async () => {
    const { getByTestId } = await renderNovo({ turmaId: "turma-1" });

    await act(async () => {
      fireEvent.press(getByTestId("tipo-PROVA"));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    await waitFor(() => {
      expect(mockedPostPontoAtencao).toHaveBeenCalledWith("token", "turma-1", {
        tipo: "PROVA",
        titulo: "Avaliação I",
        data: "2026-09-22",
        hora: undefined,
        observacao: undefined,
      });
    });
  });

  it("não deixa salvar sem título", async () => {
    const { getByTestId, queryByTestId } = await renderNovo({ turmaId: "turma-1" });

    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    expect(mockedPostPontoAtencao).not.toHaveBeenCalled();
    expect(queryByTestId("erro-titulo")).toBeTruthy();
  });

  it("não deixa salvar sem escolher uma turma no seletor", async () => {
    const { getByTestId, queryByTestId } = await renderNovo({});

    await waitFor(() => expect(mockedGetSchedule).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId("seletor-turma")).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    expect(mockedPostPontoAtencao).not.toHaveBeenCalled();
    expect(queryByTestId("erro-turma")).toBeTruthy();
  });

  it("envia o id da turma escolhida no seletor", async () => {
    const turmas = [
      turmaFalsa({ id: "turma-1", codigo: "ENGG64" }),
      turmaFalsa({ id: "turma-2", codigo: "MATA37", nome: "SISTEMAS OPERACIONAIS" }),
    ];
    const { getByTestId } = await renderNovo({ turmas });

    await waitFor(() => expect(mockedGetSchedule).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId("turma-opcao-turma-2")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId("turma-opcao-turma-2"));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    await waitFor(() => {
      expect(mockedPostPontoAtencao).toHaveBeenCalledWith(
        "token",
        "turma-2",
        expect.objectContaining({ titulo: "Avaliação I" }),
      );
    });
  });
});
