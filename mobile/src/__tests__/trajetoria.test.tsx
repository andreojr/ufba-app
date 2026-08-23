import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TrajetoriaTab from "@/screens/TrajetoriaTab";
import { ApiError, getTrajetoria } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import type {
  ComponenteCursado,
  ComponentePendente,
  Historico,
  MarcosSemestralizacao,
  TrajetoriaResponse,
} from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sync-freshness-context", () => ({
  ...jest.requireActual("@/lib/sync-freshness-context"),
  useSyncFreshness: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getTrajetoria: jest.fn(),
}));
// Mocked rather than left to SecureStore: the term's end date is what decides
// whether the staleness nudge fires, so every test has to state it.
jest.mock("@/lib/periodo-cache", () => ({
  getPeriodoCache: jest.fn(),
  savePeriodoCache: jest.fn(),
}));

// Jest's jest.mock() factory rejects out-of-scope references unless the name
// is prefixed with "mock" (case-insensitive) — this name is chosen for that,
// not stylistically.
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockRouterPush }) }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The year blocks animate their collapse with Reanimated's layout transition.
// A factory mock keeps the real module — which this project's
// transformIgnorePatterns does not transform — from ever being loaded.
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native");
  return { __esModule: true, default: { View }, LinearTransition: {} };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

// heroui-native has to be mocked by hand — see home.test.tsx, which does the
// same for the components the home screen uses. This screen needs Typography,
// Menu, Button, Tabs and useThemeColor.
jest.mock("heroui-native", () => {
  const { createContext, useContext } = jest.requireActual("react");
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  const Menu = Object.assign(({ children }: any) => <View>{children}</View>, {
    Trigger: ({ children }: any) => <View>{children}</View>,
    Portal: ({ children }: any) => <View>{children}</View>,
    Overlay: () => null,
    Content: ({ children }: any) => <View>{children}</View>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    Item: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>{children}</TouchableOpacity>
    ),
    ItemTitle: ({ children }: any) => <Text>{children}</Text>,
  });

  // A minimal stand-in for the real compound component: just enough context
  // to let a Trigger press flip which Content is shown, which is all the
  // screen's tab-switching tests need.
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
    Menu,
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

const MATRICULADO: ComponenteCursado = {
  semestre: "2026.1",
  natureza: "OB",
  codigo: "MATA55",
  nome: "SISTEMAS OPERACIONAIS",
  cargaHoraria: 68,
  nota: null,
  situacao: "MATR",
  docente: null,
};

const BANCO_DE_DADOS: ComponentePendente = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  matriculado: false,
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
  // `status` is load-bearing, not decoration: useAuth returns a discriminated
  // union and the screen reads accessToken only on the "signedIn" variant, so
  // omitting it leaves accessToken null and the screen stuck loading forever.
  // Same shape home.test.tsx uses.
  jest.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "user-1", email: "maria@example.com", name: "Maria" },
  } as ReturnType<typeof useAuth>);
  jest.mocked(useSigaaLink).mockReturnValue({ status: "linked" } as ReturnType<
    typeof useSigaaLink
  >);
  // No cached term by default, which keeps the staleness nudge quiet.
  jest.mocked(getPeriodoCache).mockResolvedValue(null);
  jest.mocked(useSyncFreshness).mockReturnValue({
    scheduleFetchedAt: null,
    historicoFetchedAt: null,
    setScheduleFetchedAt: jest.fn(),
    setHistoricoFetchedAt: jest.fn(),
  });
});

describe("Trajetória", () => {
  it("still shows the stored trajectory after the account is unlinked", async () => {
    jest.mocked(useSigaaLink).mockReturnValue({
      status: "unlinked",
      jaVinculou: true,
    } as ReturnType<typeof useSigaaLink>);
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({}));

    const { queryByText } = await render(<TrajetoriaTab />);

    await waitFor(() =>
      expect(queryByText("Vincule sua conta do SIGAA para ver sua trajetória.")).toBeNull(),
    );
    expect(jest.mocked(getTrajetoria)).toHaveBeenCalledWith("token");
  });

  it("asks an unlinked user to link when there is nothing stored", async () => {
    jest.mocked(useSigaaLink).mockReturnValue({
      status: "unlinked",
      jaVinculou: true,
    } as ReturnType<typeof useSigaaLink>);
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    const { getByText } = await render(<TrajetoriaTab />);

    await waitFor(() =>
      expect(
        getByText(
          "Vincule sua conta em Perfil para buscar seu histórico escolar no SIGAA e montar sua trajetória.",
        ),
      ).toBeTruthy(),
    );
  });

  it("points to Perfil to sync when the user has never synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/ir para perfil/i)).toBeTruthy();
    // The mock data must be gone: no invented coefficient on an empty state.
    expect(screen.queryByText("7,84")).toBeNull();
  });

  it("distinguishes a failed grade from an identical passing one", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        cursados: [
          {
            semestre: "2024.2",
            natureza: "OB",
            codigo: "MATA97",
            nome: "MATEMÁTICA DISCRETA II",
            cargaHoraria: 60,
            nota: 4,
            situacao: "REP",
            docente: null,
          },
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("4,0")).toBeTruthy();
    expect(screen.getByText("reprovado")).toBeTruthy();
  });

  it("hangs a colored status card off a matéria that deviates", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        cursados: [
          {
            semestre: "2024.2",
            natureza: "OB",
            codigo: "MATA97",
            nome: "MATEMÁTICA DISCRETA II",
            cargaHoraria: 60,
            nota: null,
            situacao: "TRANC",
            docente: null,
          },
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    const faixa = await screen.findByTestId("faixa-MATA97");
    expect(faixa.props.className).toContain("bg-warning-soft");
    // Squared off against the card below it, so the two read as continuous.
    expect(faixa.props.className).toContain("rounded-b-md");
    expect(screen.getByText("trancado")).toBeTruthy();
  });

  it("leaves an aprovada as a single card — o cabeçalho do período já disse isso", async () => {
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

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("MATA37")).toBeTruthy();
    expect(screen.queryByTestId("faixa-MATA37")).toBeNull();
    // With nothing hanging off it, the card keeps its corners all the way round.
    expect(screen.getByTestId("materia-card-MATA37").props.className).toContain("rounded-2xl");
  });

  it("names the replacement on an equivalente's status card, which now has room for it", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria(
        {
          cursados: [
            {
              semestre: "2025.1",
              natureza: "OB",
              codigo: "VELHA2",
              nome: "MATÉRIA ANTIGA",
              cargaHoraria: 60,
              nota: 8,
              situacao: "APR",
              docente: null,
            },
          ],
        },
        {
          marcos: [],
          ritmo: null,
          obsoletas: [],
          equivalencias: [{ codigo: "VELHA2", equivalenteDe: "NOVA2" }],
        },
      ),
    );

    await render(<TrajetoriaTab />);

    const faixa = await screen.findByTestId("faixa-VELHA2");
    expect(faixa.props.className).toContain("bg-success-soft");
    expect(screen.getByText("equivale a NOVA2")).toBeTruthy();
  });

  it("warns that planner placements are not saved yet", async () => {
    // The planner is session-only state (`movimentos`), and nothing writes it
    // back — but now that the periods, grades and coefficient around it are
    // the student's real transcript, a moved card reads as saved unless the
    // screen says otherwise.
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/Ainda não salva/i)).toBeTruthy();
    expect(screen.getByText(/volta para onde estava/i)).toBeTruthy();
  });

  it("shows the error card with a retry that reloads when the fetch fails", async () => {
    jest.mocked(getTrajetoria).mockRejectedValueOnce(new ApiError("Unauthorized", 401));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("Credenciais inválidas")).toBeTruthy();

    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));
    await act(async () => {
      fireEvent.press(screen.getByText("Tentar de novo"));
    });

    expect(screen.getByText("Em curso")).toBeTruthy();
    expect(screen.queryByText("Credenciais inválidas")).toBeNull();
    consoleWarn.mockRestore();
  });

  it("toque num card de matéria cursada abre a trilha curricular", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));

    await render(<TrajetoriaTab />);

    fireEvent.press(await screen.findByText("MATA55"));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA55", nome: "SISTEMAS OPERACIONAIS" },
    });
  });

  it("nudges a re-sync once the term has ended with grades still missing", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));
    jest
      .mocked(getPeriodoCache)
      .mockResolvedValue({ semestre: "2026.1", inicio: "2026-03-09", fim: "2026-07-18" });

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/O semestre acabou/i)).toBeTruthy();
    // And the term stops claiming to be running: it is over, our copy of the
    // transcript just predates the grades.
    expect(screen.getByText("Aguardando notas")).toBeTruthy();
    expect(screen.queryByText("Em curso")).toBeNull();
  });

  it("lists a pending component under the term the saved plan put it in", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({
      ...trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
      plano: [{ ...BANCO_DE_DADOS, semestre: "2026.2" }],
    } as TrajetoriaResponse);

    await render(<TrajetoriaTab />);

    // 2026.1 is in progress, so the planner offers 2026.2 and 2027.1 — and the
    // saved plan is what decides which of them holds the component.
    expect(await screen.findByText("1 matéria")).toBeTruthy();
    expect(screen.getByText("Tudo planejado.")).toBeTruthy();
  });

  it("moves a pending component to another term from its menu", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
    );

    await render(<TrajetoriaTab />);
    expect(await screen.findByText("a cursar · 1")).toBeTruthy();

    // The zone header and the menu option share the term's name; the option is
    // the later of the two, inside the component's own card.
    const opcoes = screen.getAllByText("2026.2");
    await act(async () => {
      fireEvent.press(opcoes[opcoes.length - 1]);
    });

    expect(screen.getByText("1 matéria")).toBeTruthy();
    expect(screen.getByText("Tudo planejado.")).toBeTruthy();
  });

  const LOGICA: ComponenteCursado = {
    semestre: "2025.1",
    natureza: "OB",
    codigo: "MATA37",
    nome: "INTRODUÇÃO À LÓGICA",
    cargaHoraria: 60,
    nota: 8,
    situacao: "APR",
    docente: null,
  };

  it("abre só o ano em curso e deixa os anteriores colapsados", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [LOGICA, MATRICULADO] }),
    );

    await render(<TrajetoriaTab />);

    // O ano de 2026 tem o período em curso, então é o único aberto.
    expect(await screen.findByText("MATA55")).toBeTruthy();
    expect(screen.queryByText("MATA37")).toBeNull();
    // Fechado, o ano ainda diz o que está escondendo.
    expect(screen.getByText("1 matéria")).toBeTruthy();
  });

  it("expande um ano colapsado ao tocar no cabeçalho", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [LOGICA, MATRICULADO] }),
    );

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA55");

    await act(async () => {
      fireEvent.press(screen.getByTestId("ano-2025"));
    });

    expect(screen.getByText("MATA37")).toBeTruthy();
  });

  it("colapsa o ano aberto ao tocar no cabeçalho dele", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [LOGICA, MATRICULADO] }),
    );

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA55");

    await act(async () => {
      fireEvent.press(screen.getByTestId("ano-2026"));
    });

    expect(screen.queryByText("MATA55")).toBeNull();
  });

  it("groups the periods by year", async () => {
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
          MATRICULADO,
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findAllByText("2025")).not.toHaveLength(0);
    expect(screen.getAllByText("2026")).not.toHaveLength(0);
  });

  it("shows the código, carga horária and nota on a matéria card, with no CR impact anymore", async () => {
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

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("MATA37")).toBeTruthy();
    expect(screen.getByText("· 60 h")).toBeTruthy();
    expect(screen.getByText("8,0")).toBeTruthy();
    // The old "influência no CR" line (an arrow + magnitude) is gone from
    // the timeline — that concept moved to Insights.
    expect(screen.queryByText(/↑|↓/)).toBeNull();
  });

  it("marks a light and a heavy matéria with their own density tier", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        cursados: [
          {
            semestre: "2025.1",
            natureza: "OB",
            codigo: "MATA37",
            nome: "INTRODUÇÃO À LÓGICA",
            cargaHoraria: 34,
            nota: 8,
            situacao: "APR",
            docente: null,
          },
          {
            semestre: "2025.1",
            natureza: "OB",
            codigo: "MATB90",
            nome: "TRABALHO DE CONCLUSÃO",
            cargaHoraria: 120,
            nota: 9,
            situacao: "APR",
            docente: null,
          },
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    // The tier is announced in words rather than left as a bare colored dot —
    // a 34h matéria is "leve", a 120h one "muito densa".
    expect(await screen.findByLabelText("Carga leve")).toBeTruthy();
    expect(screen.getByLabelText("Carga muito densa")).toBeTruthy();
  });

  it("ends the trajectory with a linha de chegada card", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/linha de chegada/i)).toBeTruthy();
  });

  it("still calls the term in progress while it is genuinely running", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));
    jest.mocked(getPeriodoCache).mockResolvedValue({
      semestre: "2026.1",
      inicio: "2026-03-09",
      fim: `${new Date().getFullYear() + 1}-07-18`,
    });

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("Em curso")).toBeTruthy();
    expect(screen.queryByText(/O semestre acabou/i)).toBeNull();
  });
});
