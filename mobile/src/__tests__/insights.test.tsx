import { act, fireEvent, render, screen } from "@testing-library/react-native";

import InsightsTab from "@/app/(tabs)/insights";
import { ApiError, getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type { Historico, MarcosSemestralizacao, TrajetoriaResponse } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getTrajetoria: jest.fn(),
  postTrajetoriaSync: jest.fn(),
}));
jest.mock("@/lib/periodo-cache", () => ({
  getPeriodoCache: jest.fn(),
  savePeriodoCache: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

// Same minimal heroui-native stand-in as trajetoria.test.tsx — this screen
// needs Typography, Button, Tabs and useThemeColor.
jest.mock("heroui-native", () => {
  const { createContext, useContext } = jest.requireActual("react");
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  const TabsContext = createContext({
    value: "",
    onValueChange: (_v: string) => {},
  });
  const Tabs = Object.assign(
    ({ children, value, onValueChange }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <View>{children}</View>
      </TabsContext.Provider>
    ),
    {
      List: ({ children }: any) => <View>{children}</View>,
      Indicator: () => null,
      Trigger: ({ value, children }: any) => {
        const ctx = useContext(TabsContext);
        return (
          <TouchableOpacity onPress={() => ctx.onValueChange(value)}>{children}</TouchableOpacity>
        );
      },
      Label: ({ children }: any) => <Text>{children}</Text>,
      Content: ({ value, children }: any) => {
        const ctx = useContext(TabsContext);
        return ctx.value === value ? <View>{children}</View> : null;
      },
    },
  );

  return {
    Tabs,
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

const CARGA_ZERADA = {
  obrigatorias: { exigida: 0, integralizada: 0, pendente: 0 },
  optativas: { exigida: 0, integralizada: 0, pendente: 0 },
  complementares: { exigida: 0, integralizada: 0, pendente: 0 },
  total: { exigida: 0, integralizada: 0, pendente: 0 },
};

function trajetoria(
  historico: Partial<Historico>,
  marcos: MarcosSemestralizacao | null = null,
): TrajetoriaResponse {
  return {
    fetchedAt: "2026-08-19T03:35:00.000Z",
    plano: [],
    marcos,
    historico: {
      indices: { cr: null, iap: null },
      cursados: [],
      pendentesObrigatorios: [],
      cargaHoraria: CARGA_ZERADA,
      equivalencias: [],
      observacoes: [],
      prazoConclusaoMaximo: "2030.2",
      ...historico,
    } as Historico,
  };
}

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "user-1", email: "maria@example.com", name: "Maria" },
  } as ReturnType<typeof useAuth>);
  jest.mocked(useSigaaLink).mockReturnValue({ status: "linked" } as ReturnType<typeof useSigaaLink>);
  jest.mocked(getSigaaCredentials).mockResolvedValue({
    login: "209900011",
    senha: "segredo",
    syncMode: "device",
  });
  jest.mocked(getPeriodoCache).mockResolvedValue(null);
});

describe("Insights", () => {
  it("offers to sync when the user has never synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    await render(<InsightsTab />);

    expect(await screen.findByText(/sincronizar histórico/i)).toBeTruthy();
  });

  it("shows the coefficient, the carga horária card and the progress bars once synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        indices: { cr: 8.1597, iap: 0.8434 },
        cargaHoraria: {
          obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
          optativas: { exigida: 360, integralizada: 0, pendente: 360 },
          complementares: { exigida: 100, integralizada: 0, pendente: 100 },
          total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
        },
      }),
    );

    await render(<InsightsTab />);

    // The CR tab is the default: two decimals, the CR, not a grade.
    expect(await screen.findByText("8,16")).toBeTruthy();
    expect(screen.getByText(/58% do curso/i)).toBeTruthy();
    expect(screen.getByText("3.610 h")).toBeTruthy();
    // Both stats stay mounted at all times — the card slides between them.
    expect(screen.getByText("2.100 h")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText("Carga Horária"));
    });

    expect(screen.getByText("2.100 h")).toBeTruthy();
    expect(screen.getByText("8,16")).toBeTruthy();
  });

  it("shows a separate progress bar and percentage for each natureza, plus one for the course overall", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        cargaHoraria: {
          obrigatorias: { exigida: 200, integralizada: 100, pendente: 100 },
          optativas: { exigida: 100, integralizada: 20, pendente: 80 },
          complementares: { exigida: 50, integralizada: 50, pendente: 0 },
          total: { exigida: 350, integralizada: 170, pendente: 180 },
        },
      }),
    );

    await render(<InsightsTab />);

    expect(await screen.findByText("Obrigatórias")).toBeTruthy();
    expect(screen.getByText("Optativas")).toBeTruthy();
    expect(screen.getByText("Complementares")).toBeTruthy();
    expect(screen.getByText(/50%.*das obrigatórias/is)).toBeTruthy();
    expect(screen.getByText(/20%.*concluído/is)).toBeTruthy();
    expect(screen.getByText(/100%.*concluído/is)).toBeTruthy();
    expect(screen.getByText(/49% do curso/i)).toBeTruthy();
  });

  it("shows how much the CR moved since the term before, beside the current CR", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        indices: { cr: 8.5, iap: null },
        cursados: [
          {
            semestre: "2025.1",
            natureza: "OB",
            codigo: "MATA37",
            nome: "INTRODUÇÃO À LÓGICA",
            cargaHoraria: 60,
            nota: 8,
            situacao: "APR",
            docente: null,
          },
          {
            semestre: "2025.2",
            natureza: "OB",
            codigo: "MATA40",
            nome: "CÁLCULO A",
            cargaHoraria: 60,
            nota: 9,
            situacao: "APR",
            docente: null,
          },
        ],
      }),
    );

    await render(<InsightsTab />);

    expect(await screen.findByTestId("cr-variacao")).toHaveTextContent("↑ 0,50");
  });

  it("shows a carga horária bar chart once that tab is selected", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        cursados: [
          {
            semestre: "2025.1",
            natureza: "OB",
            codigo: "MATA37",
            nome: "INTRODUÇÃO À LÓGICA",
            cargaHoraria: 60,
            nota: 8,
            situacao: "APR",
            docente: null,
          },
        ],
      }),
    );

    await render(<InsightsTab />);
    await screen.findByText("Coeficiente de Rendimento");

    await act(async () => {
      fireEvent.press(screen.getByText("Carga Horária"));
    });

    expect(screen.getByTestId("bar-chart")).toBeTruthy();
    expect(screen.getByTestId("line-chart")).toBeTruthy();
  });

  it("surfaces a sync failure without wiping the disclosure already on screen", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest.mocked(postTrajetoriaSync).mockRejectedValue(new ApiError("Boom", 500));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<InsightsTab />);
    await act(async () => {
      fireEvent.press(await screen.findByText(/sincronizar histórico/i));
    });

    expect(screen.getByText(/Pode ser um problema no documento/i)).toBeTruthy();
    expect(screen.getByText(/baixar o PDF em Documentos/i)).toBeTruthy();
    consoleWarn.mockRestore();
  });

  it("shows the error card with a retry that reloads when the fetch fails", async () => {
    jest.mocked(getTrajetoria).mockRejectedValueOnce(new ApiError("Unauthorized", 401));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<InsightsTab />);

    expect(await screen.findByText("Credenciais inválidas")).toBeTruthy();

    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ indices: { cr: 7, iap: null } }));
    await act(async () => {
      fireEvent.press(screen.getByText("Tentar de novo"));
    });

    expect(await screen.findByText("7,00")).toBeTruthy();
    expect(screen.queryByText("Credenciais inválidas")).toBeNull();
    consoleWarn.mockRestore();
  });
});
