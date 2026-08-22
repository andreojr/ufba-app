import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import VizinhosCurricularesScreen from "@/app/arvore-dependencias";
import { getVizinhosCurriculares } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ codigo: "MATA03", nome: "Cálculo B" }),
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack }),
}));

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getVizinhosCurriculares: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    ),
    Spinner: (props: any) => <View testID={props.testID} />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: (keys: string[]) => keys.map(() => "#888888"),
  };
});

const mockedGet = getVizinhosCurriculares as jest.MockedFunction<typeof getVizinhosCurriculares>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("VizinhosCurricularesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token-123",
      user: { curso: "ENGENHARIA/PGCOMP - Salvador" },
    } as unknown as ReturnType<typeof useAuth>);
  });

  it("mostra loading enquanto a busca está em andamento", async () => {
    let resolver: ((value: Awaited<ReturnType<typeof getVizinhosCurriculares>>) => void) | undefined;
    mockedGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        })
    );

    await render(<VizinhosCurricularesScreen />);
    expect(screen.getByTestId("vizinhos-curriculares-loading")).toBeTruthy();

    resolver?.({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [{ codigo: "MATA04", nome: "Cálculo C", situacao: "bloqueada" }],
    });
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
  });

  it("mostra a matéria atual, pré-requisitos e o que ela desbloqueia", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [
        { codigo: "MATA04", nome: "Cálculo C", situacao: "bloqueada" },
        { codigo: "ENGC30", nome: "Mecânica dos Sólidos", situacao: "liberada" },
      ],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    // "Cálculo B" aparece duas vezes aqui: no header (nome do param de rota,
    // fixo no mock de useLocalSearchParams acima) e no card em destaque da
    // matéria atual — coincidência proposital desta fixture (o card atual É
    // o MATA03/Cálculo B da rota), não uma duplicação indevida na tela.
    expect(screen.getAllByText("Cálculo B").length).toBeGreaterThan(0);
    expect(screen.getByText("Cálculo C")).toBeTruthy();
    expect(screen.getByText("Mecânica dos Sólidos")).toBeTruthy();
  });

  it("não mostra o bloco de pré-requisitos quando a matéria não tem nenhum", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" },
      preRequisitos: [],
      desbloqueia: [{ codigo: "MATA03", nome: "Cálculo B", situacao: "liberada" }],
    });

    await render(<VizinhosCurricularesScreen />);
    // Ver o comentário no teste anterior: "Cálculo B" também aparece no
    // header (mesmo nome fixo do mock de useLocalSearchParams), então dois
    // matches é o esperado aqui — não uma duplicação indevida.
    await waitFor(() => expect(screen.getAllByText("Cálculo B").length).toBeGreaterThan(0));
    expect(screen.queryByText("Pré-requisito")).toBeNull();
  });

  it("não mostra o bloco de desbloqueia quando não há nenhuma matéria", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "ENGC99", nome: "Trabalho de Conclusão", situacao: "liberada" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    expect(screen.queryByText("Desbloqueia")).toBeNull();
  });

  it("toque num card de pré-requisito navega pra ele", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vizinho-card-MATA02"));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA02", nome: "Cálculo A" },
    });
  });

  it("mostra erro quando a busca falha", async () => {
    mockedGet.mockRejectedValue(new Error("falhou"));

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());
  });

  it("tenta buscar de novo ao apertar o botão de retry no estado de erro", async () => {
    mockedGet.mockRejectedValueOnce(new Error("timeout"));

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());

    mockedGet.mockResolvedValueOnce({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [],
      desbloqueia: [],
    });
    fireEvent.press(screen.getByText("Tentar novamente"));

    await waitFor(() => expect(screen.getByText("Cálculo B")).toBeTruthy());
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("mostra mensagem específica quando o código raiz não está na grade ativa (404 de ComponenteDesconhecidoError)", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    // A mensagem cita o código da rota (MATA03, fixo no mock de useLocalSearchParams
    // acima) — é assim que a tela distingue esse erro do de curso não encontrado.
    mockedGet.mockRejectedValue(
      new ApiError("Component MATA03 is not in course curso-1's active curriculum structure", 404),
    );

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("vizinhos-curriculares-nao-na-grade")).toBeTruthy()
    );
  });

  it("um 404 de curso não encontrado (não cita o código) cai no estado de erro genérico", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    mockedGet.mockRejectedValue(
      new ApiError("Course ENGENHARIA DA COMPUTAÇÃO is not in the directory", 404),
    );

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());
  });

  it("toque num card de desbloqueia também navega pro mesmo pathname — a mesma tela recebe o próximo nível em cascata", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [{ codigo: "MATA04", nome: "Cálculo C", situacao: "bloqueada" }],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Cálculo C")).toBeTruthy());

    // Primeiro nível: toca no pré-requisito.
    fireEvent.press(screen.getByTestId("vizinho-card-MATA02"));
    expect(mockRouterPush).toHaveBeenNthCalledWith(1, {
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA02", nome: "Cálculo A" },
    });

    // Segundo nível: toca num card de desbloqueia. Mesma pathname que o
    // primeiro toque — é essa repetição que permite empilhar quantos níveis
    // o aluno quiser (cascata), cada um um push da mesma rota recentrada no
    // vizinho tocado, e não um modal one-shot que só fecha um de cada vez.
    fireEvent.press(screen.getByTestId("vizinho-card-MATA04"));
    expect(mockRouterPush).toHaveBeenNthCalledWith(2, {
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA04", nome: "Cálculo C" },
    });
    expect(mockRouterPush).toHaveBeenCalledTimes(2);
  });
});
