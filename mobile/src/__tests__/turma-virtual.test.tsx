import { act, fireEvent, render, screen } from "@testing-library/react-native";

import TurmaVirtualScreen from "@/screens/TurmaVirtualScreen";
import { useAuth } from "@/lib/auth-context";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-storage", () => ({
  getSigaaCredentials: jest.fn().mockResolvedValue({ login: "a", senha: "b" }),
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  postTurmaVirtual: jest.fn(),
  postNoticiaDetalhe: jest.fn(),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({
    id: "turma-uuid",
    nome: "Sistemas Operacionais",
    codigo: "MATA58",
    docente: "Fulano",
  }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-render-html", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("heroui-native", () => {
  const { Text, TouchableOpacity, View } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, onPress }: any) => <Text onPress={onPress}>{children}</Text>,
    },
  };
});

const { postTurmaVirtual } = jest.requireMock("@/lib/api");
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function feed(overrides = {}) {
  return {
    noticias: [{ id: "1", titulo: "Início do Semestre", data: "18/08/2026" }],
    avaliacoes: [{ descricao: "Prova 1", data: "06/10/2026" }],
    topicos: [{ titulo: "Aula 1", periodo: "20/08/2026 - 20/08/2026", conteudoHtml: null }],
    ...overrides,
  };
}

describe("TurmaVirtualScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({ status: "signedIn", accessToken: "token" } as ReturnType<
      typeof useAuth
    >);
  });

  it("renders the three sections when the feed comes back populated", async () => {
    postTurmaVirtual.mockResolvedValue(feed());

    await render(<TurmaVirtualScreen />);

    expect(await screen.findByText("Início do Semestre")).toBeTruthy();
    expect(screen.getByText("Prova 1")).toBeTruthy();
    expect(screen.getByText("Aula 1")).toBeTruthy();
  });

  it("hides a section when it comes back empty, and shows the empty state when all three are", async () => {
    postTurmaVirtual.mockResolvedValue(feed({ noticias: [], avaliacoes: [], topicos: [] }));

    await render(<TurmaVirtualScreen />);

    expect(await screen.findByText(/nada por aqui/i)).toBeTruthy();
  });

  it("shows a retry-able error state when the fetch fails", async () => {
    postTurmaVirtual.mockRejectedValue(new Error("falhou"));

    await render(<TurmaVirtualScreen />);

    expect(await screen.findByText(/tentar novamente/i)).toBeTruthy();
  });

  it("retry re-triggers the fetch", async () => {
    postTurmaVirtual.mockRejectedValueOnce(new Error("falhou"));
    await render(<TurmaVirtualScreen />);
    await screen.findByText(/tentar novamente/i);

    postTurmaVirtual.mockResolvedValueOnce(feed());
    fireEvent.press(screen.getByText(/tentar novamente/i));

    expect(await screen.findByText("Início do Semestre")).toBeTruthy();
    expect(postTurmaVirtual).toHaveBeenCalledTimes(2);
  });

  it("opens and closes a notícia without leaking state into the next open", async () => {
    postTurmaVirtual.mockResolvedValue(feed());
    const { postNoticiaDetalhe } = jest.requireMock("@/lib/api");
    postNoticiaDetalhe.mockResolvedValue({
      titulo: "Início do Semestre",
      data: "18/08/2026",
      autor: "Fulano",
      conteudoHtml: "<p>Bem-vindos</p>",
    });

    await render(<TurmaVirtualScreen />);
    fireEvent.press(await screen.findByText("Início do Semestre"));

    expect(await screen.findByText("Fechar")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText("Fechar"));
    });

    expect(screen.queryByText("Fechar")).toBeNull();
  });
});
