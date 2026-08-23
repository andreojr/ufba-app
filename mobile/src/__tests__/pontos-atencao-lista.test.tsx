import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { deleteVotoPontoAtencao, getPontosAtencao, putVotoPontoAtencao } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PontoAtencao } from "@/lib/types";

import PontosAtencaoScreen from "@/app/pontos-atencao";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getPontosAtencao: jest.fn(),
  putVotoPontoAtencao: jest.fn(),
  deleteVotoPontoAtencao: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, TouchableOpacity } = jest.requireActual("react-native");

  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
    Button: ({ children, onPress, testID }: any) => (
      <TouchableOpacity onPress={onPress} testID={testID} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <Text>loading</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
  };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetPontosAtencao = jest.mocked(getPontosAtencao);
const mockedPutVoto = jest.mocked(putVotoPontoAtencao);
const mockedDeleteVoto = jest.mocked(deleteVotoPontoAtencao);

function pontoFalso(overrides: Partial<PontoAtencao> = {}): PontoAtencao {
  return {
    id: "p0",
    turmaId: "turma-1",
    turmaCodigo: "MATA37",
    turmaNome: "SISTEMAS OPERACIONAIS",
    tipo: "TRABALHO",
    titulo: "Prazo genérico",
    data: "2026-09-30",
    hora: null,
    observacao: null,
    responsavel: { nome: "Ana Silva" },
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    estado: "NORMAL",
    podeEditar: false,
    podeApagar: false,
    ...overrides,
  };
}

async function renderLista({ pontos }: { pontos: PontoAtencao[] }) {
  mockedUseAuth.mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
  } as any);
  mockedGetPontosAtencao.mockResolvedValue(pontos);

  const utils = await render(<PontosAtencaoScreen />);
  await waitFor(() => expect(mockedGetPontosAtencao).toHaveBeenCalled());
  return utils;
}

describe("PontosAtencaoScreen (lista completa)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("mostra o item contestado apagado, com o motivo e o botão de corrigir", async () => {
    const { getByTestId } = await renderLista({
      pontos: [pontoFalso({ id: "p1", estado: "CONTESTADO", contestacoes: 3 })],
    });

    const item = await waitFor(() => getByTestId("ponto-p1"));
    expect(item).toHaveTextContent("3 colegas contestaram esta data", { exact: false });
    expect(getByTestId("corrigir-p1")).toBeTruthy();
  });

  it("registra a contestação", async () => {
    mockedPutVoto.mockResolvedValue(pontoFalso({ id: "p1", meuVoto: "CONTESTA", contestacoes: 1 }));
    const { getByTestId } = await renderLista({ pontos: [pontoFalso({ id: "p1" })] });

    await act(async () => {
      fireEvent.press(getByTestId("contestar-p1"));
    });

    await waitFor(() => {
      expect(mockedPutVoto).toHaveBeenCalledWith("token", "p1", "CONTESTA");
    });
  });

  it("desfaz o voto ao tocar de novo no mesmo botão", async () => {
    mockedDeleteVoto.mockResolvedValue(pontoFalso({ id: "p1", meuVoto: null }));
    const { getByTestId } = await renderLista({
      pontos: [pontoFalso({ id: "p1", meuVoto: "CONFIRMA" })],
    });

    await act(async () => {
      fireEvent.press(getByTestId("confirmar-p1"));
    });

    await waitFor(() => {
      expect(mockedDeleteVoto).toHaveBeenCalledWith("token", "p1");
    });
  });

  it("não mostra botões de voto num item vencido", async () => {
    const { getByTestId, queryByTestId } = await renderLista({
      pontos: [pontoFalso({ id: "p1", data: "2020-01-01" })],
    });

    await waitFor(() => expect(getByTestId("ponto-p1")).toBeTruthy());
    expect(queryByTestId("confirmar-p1")).toBeNull();
    expect(queryByTestId("contestar-p1")).toBeNull();
  });

  it("navega para a tela de edição ao tocar em Corrigir", async () => {
    const { getByTestId } = await renderLista({
      pontos: [pontoFalso({ id: "p1", estado: "CONTESTADO", contestacoes: 2 })],
    });

    await act(async () => {
      fireEvent.press(getByTestId("corrigir-p1"));
    });

    expect(mockPush).toHaveBeenCalledWith("/ponto-de-atencao/p1");
  });
});
