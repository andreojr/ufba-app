import { render, screen, waitFor } from "@testing-library/react-native";

import ArvoreDependenciasScreen from "@/app/arvore-dependencias";
import { getArvoreDependencias } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
  const { Text, View } = jest.requireActual("react-native");
  return {
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
});
