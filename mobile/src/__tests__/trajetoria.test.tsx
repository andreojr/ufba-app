import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TrajetoriaTab from "@/app/(tabs)/trajetoria";
import { ApiError, getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type {
  ComponenteCursado,
  ComponentePendente,
  Historico,
  TrajetoriaResponse,
} from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getTrajetoria: jest.fn(),
  postTrajetoriaSync: jest.fn(),
}));
// Mocked rather than left to SecureStore: the term's end date is what decides
// whether the staleness nudge fires, so every test has to state it.
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

function trajetoria(historico: Partial<Historico>): TrajetoriaResponse {
  return {
    fetchedAt: "2026-08-19T03:35:00.000Z",
    plano: [],
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

/**
 * Pull-to-refresh, which has no fireEvent path in RTL v14: the UNSAFE_*ByType
 * queries are gone from both `screen` and the render result, and a
 * RefreshControl never enters the queryable tree — it stays a prop on the
 * ScrollView host node. Calling the handler is not a vacuous assertion: unwire
 * the RefreshControl and `onRefresh` is undefined, so this throws.
 */
async function puxarParaAtualizar(): Promise<void> {
  const scroll = screen.getByTestId("trajetoria-scroll");
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
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
  jest.mocked(getSigaaCredentials).mockResolvedValue({
    login: "209900011",
    senha: "segredo",
    syncMode: "device",
  });
  // No cached term by default, which keeps the staleness nudge quiet.
  jest.mocked(getPeriodoCache).mockResolvedValue(null);
});

describe("Trajetória", () => {
  it("offers to sync when the user has never synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/sincronizar histórico/i)).toBeTruthy();
    // The mock data must be gone: no invented coefficient on an empty state.
    expect(screen.queryByText("7,84")).toBeNull();
  });

  it("discloses what is kept and what is discarded before the first sync", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    await render(<TrajetoriaTab />);

    // Both halves, not just the reassuring one: grades ARE stored, and a
    // disclosure that only said "nothing sensitive is kept" would be false by
    // omission. This is the user-facing end of the same requirement Task 3
    // asserts from the parser's end.
    expect(await screen.findByText(/O que fica guardado/i)).toBeTruthy();
    expect(screen.getByText(/matérias, notas e carga horária/i)).toBeTruthy();
    expect(screen.getByText(/O que não fica/i)).toBeTruthy();
    expect(screen.getByText(/CPF, RG e data de nascimento/i)).toBeTruthy();
  });

  it("shows the coefficient and progress once synced", async () => {
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

    await render(<TrajetoriaTab />);

    // The CR tab is the default: two decimals, the CR, not a grade —
    // formatarNota would print 8,2 here.
    expect(await screen.findByText("8,16")).toBeTruthy();
    expect(screen.getByText(/58% do curso/i)).toBeTruthy();
    // The main card shows only one of the two stats at a time.
    expect(screen.queryByText("2.100/3.610 h")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText("Carga Horária"));
    });

    // Thousands separated the pt-BR way, as the design printed them.
    expect(screen.getByText("2.100/3.610 h")).toBeTruthy();
    expect(screen.queryByText("8,16")).toBeNull();
    // The progress row is shared by both tabs, not tied to either stat.
    expect(screen.getByText(/58% do curso/i)).toBeTruthy();
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

  it("surfaces a sync failure without wiping what is already on screen", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest.mocked(postTrajetoriaSync).mockRejectedValue(new Error("SIGAA fora do ar"));
    // The screen logs the failure on its way to the message; expected here.
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);
    // Async act: the press starts a promise chain, and only this form flushes
    // the state updates it lands on.
    await act(async () => {
      fireEvent.press(await screen.findByText(/sincronizar histórico/i));
    });

    await waitFor(() => {
      expect(screen.getByText(/não deu para sincronizar/i)).toBeTruthy();
    });
    // The disclosure and the button are still there: a failed sync explains
    // itself, it does not blank the screen.
    expect(screen.getByText(/O que fica guardado/i)).toBeTruthy();
    consoleWarn.mockRestore();
  });

  it("does not tell the student to retry a failure that will fail identically", async () => {
    // A transcript the parser refuses arrives as a bare 500. Retrying it loops,
    // so the copy must not send the student round again.
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest
      .mocked(postTrajetoriaSync)
      .mockRejectedValue(new ApiError("Internal server error", 500));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);
    await act(async () => {
      fireEvent.press(await screen.findByText(/sincronizar histórico/i));
    });

    expect(screen.getByText(/Pode ser um problema no documento/i)).toBeTruthy();
    expect(screen.getByText(/baixar o PDF em Documentos/i)).toBeTruthy();
    expect(screen.queryByText(/Tente novamente/i)).toBeNull();
    // The raw backend message never reaches the student.
    expect(screen.queryByText(/Internal server error/i)).toBeNull();
    consoleWarn.mockRestore();
  });

  it("keeps the shared wording for the failures a retry really does fix", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest.mocked(postTrajetoriaSync).mockRejectedValue(new ApiError("Unauthorized", 401));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);
    await act(async () => {
      fireEvent.press(await screen.findByText(/sincronizar histórico/i));
    });

    expect(screen.getByText(/Credenciais inválidas/i)).toBeTruthy();
    expect(screen.queryByText(/Pode ser um problema no documento/i)).toBeNull();
    consoleWarn.mockRestore();
  });

  it("clears a past sync failure once a load succeeds", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest.mocked(postTrajetoriaSync).mockRejectedValue(new ApiError("Boom", 500));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);
    await act(async () => {
      fireEvent.press(await screen.findByText(/sincronizar histórico/i));
    });
    expect(screen.getByText(/não deu para sincronizar/i)).toBeTruthy();

    // The refresh repaints real data; a stale failure sitting under it would
    // contradict what the student is now reading.
    jest.mocked(getTrajetoria).mockResolvedValue(trajetoria({ cursados: [MATRICULADO] }));
    await puxarParaAtualizar();

    expect(screen.getByText("Em curso")).toBeTruthy();
    expect(screen.queryByText(/não deu para sincronizar/i)).toBeNull();
    consoleWarn.mockRestore();
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

  it("keeps the moves the student made across a pull-to-refresh", async () => {
    // A plain GET is not a re-sync: nothing about the plan changed, so watching
    // a move revert with no feedback would read as a bug.
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
    );

    await render(<TrajetoriaTab />);
    expect(await screen.findByText("a cursar · 1")).toBeTruthy();

    const opcoes = screen.getAllByText("2026.2");
    await act(async () => {
      fireEvent.press(opcoes[opcoes.length - 1]);
    });
    expect(screen.getByText("1 matéria")).toBeTruthy();

    await puxarParaAtualizar();

    expect(screen.getByText("1 matéria")).toBeTruthy();
    expect(screen.getByText("Tudo planejado.")).toBeTruthy();
  });

  it("drops the moves after a re-sync, where the server's plan is the authority", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
    );
    jest.mocked(postTrajetoriaSync).mockResolvedValue(
      trajetoria({ cursados: [MATRICULADO], pendentesObrigatorios: [BANCO_DE_DADOS] }),
    );

    await render(<TrajetoriaTab />);
    expect(await screen.findByText("a cursar · 1")).toBeTruthy();

    const opcoes = screen.getAllByText("2026.2");
    await act(async () => {
      fireEvent.press(opcoes[opcoes.length - 1]);
    });
    expect(screen.getByText("1 matéria")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText("Sincronizar"));
    });

    // Back in the pool: the re-scrape replaced the transcript the move was made
    // against, and it came back with an empty plan.
    expect(screen.getByText("a cursar · 1")).toBeTruthy();
    expect(screen.queryByText("1 matéria")).toBeNull();
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

  it("groups the periods by year and shows each matéria's impact on the CR", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      trajetoria({
        indices: { cr: 7, iap: null },
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
            semestre: "2025.1",
            natureza: "OB",
            codigo: "MATA40",
            nome: "CÁLCULO A",
            cargaHoraria: 60,
            nota: 6,
            situacao: "APR",
            docente: null,
          },
          MATRICULADO,
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    // Year header groups 2025.1 with 2026.1's own year — one appears at least
    // twice (the grid's own header, plus the CR chart's x-axis label), which
    // is exactly the point: the chart only labels a year once too.
    expect(await screen.findAllByText("2025")).not.toHaveLength(0);
    expect(screen.getAllByText("2026")).not.toHaveLength(0);

    // MATA37's 8 sits above the CR computed without it (6): a positive pull.
    expect(screen.getByText("↑ 1,00")).toBeTruthy();
    // MATA40's 6 sits below the CR computed without it (8): a negative pull.
    expect(screen.getByText("↓ 1,00")).toBeTruthy();
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

    await render(<TrajetoriaTab />);

    // Cumulative CR: 8 after 2025.1, (60·8+60·9)/120 = 8.5 after 2025.2 — up
    // half a point from the term before. Queried by testID, not text: with
    // only two graded components, one of them will always show this exact
    // same impacto text too (removing the only component in the latest term
    // is mathematically identical to reverting to the term before it).
    expect(await screen.findByTestId("cr-variacao")).toHaveTextContent("↑ 0,50");
  });

  it("shows no change as a plain dash rather than an arrow on a flat CR", async () => {
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
          {
            semestre: "2025.2",
            natureza: "OB",
            codigo: "MATA40",
            nome: "CÁLCULO A",
            cargaHoraria: 60,
            nota: 8,
            situacao: "APR",
            docente: null,
          },
        ],
      }),
    );

    await render(<TrajetoriaTab />);

    // Both terms average out to the same 8 — no real movement to show as an
    // arrow.
    expect(await screen.findByTestId("cr-variacao")).toHaveTextContent("—");
  });

  it("shows a carga horária bar chart with no grades once that tab is selected", async () => {
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
    await screen.findByText("INTRODUÇÃO À LÓGICA");

    // CR tab (the default) shows the grade.
    expect(screen.getByText("8,0")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText("Carga Horária"));
    });

    // The grade is gone from the switched tab; only the hours remain.
    expect(screen.queryByText("8,0")).toBeNull();
    expect(screen.getByTestId("bar-chart")).toBeTruthy();
    expect(screen.queryByTestId("line-chart")).toBeNull();
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
    expect(screen.getByText(/Sincronizado em/i)).toBeTruthy();
  });
});
