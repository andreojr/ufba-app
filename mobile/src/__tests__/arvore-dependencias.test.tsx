import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import ArvoreDependenciasScreen from "@/app/arvore-dependencias";
import { getArvoreDependencias } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

interface NoJsonSimplificado {
  type: string;
  props?: Record<string, unknown>;
  children?: (NoJsonSimplificado | string)[] | null;
}

// react-native-svg's native <Text>/<TSpan> render their string children into
// a `content` prop on the RNSVGTSpan host node instead of exposing them as
// queryable accessible text under RNTL — so assertions on rendered node
// labels (ver finding #3) walk the JSON tree for that prop directly.
function coletarTextosSvg(
  json: NoJsonSimplificado | (NoJsonSimplificado | string)[] | string | null
): string[] {
  if (!json || typeof json === "string") return [];
  const nos = Array.isArray(json) ? json : [json];
  const textos: string[] = [];
  for (const no of nos) {
    if (typeof no === "string") continue;
    if (no.type === "RNSVGTSpan" && typeof no.props?.content === "string") {
      textos.push(no.props.content as string);
    }
    if (no.children) {
      textos.push(...coletarTextosSvg(no.children));
    }
  }
  return textos;
}

function coletarNosPorTipo(
  json: NoJsonSimplificado | (NoJsonSimplificado | string)[] | string | null,
  tipo: string
): NoJsonSimplificado[] {
  if (!json || typeof json === "string") return [];
  const nos = Array.isArray(json) ? json : [json];
  const encontrados: NoJsonSimplificado[] = [];
  for (const no of nos) {
    if (typeof no === "string") continue;
    if (no.type === tipo) encontrados.push(no);
    if (no.children) encontrados.push(...coletarNosPorTipo(no.children, tipo));
  }
  return encontrados;
}

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ codigo: "MATA02", nome: "Cálculo A" }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getArvoreDependencias: jest.fn(),
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

const mockedGet = getArvoreDependencias as jest.MockedFunction<typeof getArvoreDependencias>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("ArvoreDependenciasScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token-123",
      user: { curso: "ENGENHARIA/PGCOMP - Salvador" },
    } as unknown as ReturnType<typeof useAuth>);
  });

  it("mostra loading enquanto a busca está em andamento", async () => {
    let resolver: ((value: Awaited<ReturnType<typeof getArvoreDependencias>>) => void) | undefined;
    mockedGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        })
    );

    await render(<ArvoreDependenciasScreen />);
    expect(screen.getByTestId("arvore-dependencias-loading")).toBeTruthy();

    resolver?.({
      nos: [
        { codigo: "MATA02", nome: "Cálculo A", periodo: 1 },
        { codigo: "MATA03", nome: "Cálculo B", periodo: 2 },
      ],
      arestas: [{ de: "MATA02", para: "MATA03" }],
    });
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-svg")).toBeTruthy());
  });

  it("mostra estado vazio quando a matéria não tem descendentes", async () => {
    mockedGet.mockResolvedValue({
      nos: [{ codigo: "MATA02", nome: "Cálculo A", periodo: 1 }],
      arestas: [],
    });

    await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-vazio")).toBeTruthy());
  });

  it("mostra erro quando a busca falha", async () => {
    mockedGet.mockRejectedValue(new Error("falhou"));

    await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-erro")).toBeTruthy());
  });

  it("tenta buscar de novo ao apertar o botão de retry no estado de erro", async () => {
    mockedGet.mockRejectedValueOnce(new Error("timeout"));

    await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-erro")).toBeTruthy());

    mockedGet.mockResolvedValueOnce({
      nos: [
        { codigo: "MATA02", nome: "Cálculo A", periodo: 1 },
        { codigo: "MATA03", nome: "Cálculo B", periodo: 2 },
      ],
      arestas: [{ de: "MATA02", para: "MATA03" }],
    });
    fireEvent.press(screen.getByText("Tentar novamente"));

    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-svg")).toBeTruthy());
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("mostra mensagem específica quando o código raiz não está na grade ativa (404 de ComponenteDesconhecidoError)", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    // Mensagem real do backend (ComponenteDesconhecidoError) — cita o código
    // exato, ao contrário de um 404 de curso não encontrado (ver teste abaixo).
    mockedGet.mockRejectedValue(
      new ApiError(
        "Component MATA02 is not in course curso-1's active curriculum structure",
        404,
      ),
    );

    await render(<ArvoreDependenciasScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("arvore-dependencias-nao-na-grade")).toBeTruthy()
    );
    expect(screen.queryByTestId("arvore-dependencias-vazio")).toBeNull();
  });

  it("um 404 de curso não encontrado (não cita o código) cai no estado de erro genérico, não 'não está na grade'", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    // Mensagem real do backend para CursoDesconhecidoError — mesmo status
    // (404) do ComponenteDesconhecidoError, mas sobre o CURSO, não a matéria.
    // Tratar os dois como o mesmo estado mostraria "matéria não está na
    // grade" para toda e qualquer matéria sempre que o curso do usuário não
    // bater com o diretório — mesmo pra matérias que estão na grade.
    mockedGet.mockRejectedValue(
      new ApiError("Course ENGENHARIA DA COMPUTAÇÃO is not in the directory", 404),
    );

    await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-erro")).toBeTruthy());
    expect(screen.queryByTestId("arvore-dependencias-nao-na-grade")).toBeNull();
  });

  it("renderiza o nome da matéria (não só o código) dentro de cada nó do grafo", async () => {
    mockedGet.mockResolvedValue({
      nos: [
        { codigo: "MATA02", nome: "Cálculo A", periodo: 1 },
        { codigo: "MATA03", nome: "Cálculo B", periodo: 2 },
      ],
      arestas: [{ de: "MATA02", para: "MATA03" }],
    });

    const resultado = await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-svg")).toBeTruthy());

    const textos = coletarTextosSvg(resultado.toJSON());
    expect(textos).toContain("Cálculo A");
    expect(textos).toContain("Cálculo B");
  });

  it("usa um orient de Marker que o Android suporta ('auto' ou número, nunca 'auto-start-reverse')", async () => {
    // Regressão de crash real em dispositivo: o código nativo Android do
    // react-native-svg (MarkerView.java:125, até 15.12.1 e ainda no main
    // upstream) só aceita "auto" ou um número — qualquer outra string
    // (inclusive "auto-start-reverse", válido na spec SVG 2) cai em
    // Double.parseDouble e derruba o app com NumberFormatException na fase
    // de draw. Como o marker daqui só é usado via markerEnd, "auto" é
    // visualmente idêntico por spec.
    mockedGet.mockResolvedValue({
      nos: [
        { codigo: "MATA02", nome: "Cálculo A", periodo: 1 },
        { codigo: "MATA03", nome: "Cálculo B", periodo: 2 },
      ],
      arestas: [{ de: "MATA02", para: "MATA03" }],
    });

    const resultado = await render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-svg")).toBeTruthy());

    const markers = coletarNosPorTipo(resultado.toJSON(), "RNSVGMarker");
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      const orient = String(marker.props?.orient);
      const suportadoNoAndroid = orient === "auto" || Number.isFinite(Number(orient));
      expect(suportadoNoAndroid).toBe(true);
    }
  });
});
