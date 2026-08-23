import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TrajetoriaTab from "@/screens/TrajetoriaTab";
import { ApiError, getTrajetoria, putPlano } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getPeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import type {
  ComponenteCursado,
  Historico,
  MarcosSemestralizacao,
  ProjecaoTrajetoria,
  SemestreProjetado,
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
  putPlano: jest.fn(),
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
  const React = jest.requireActual("react");
  const { createContext, useContext, useState, cloneElement } = React;
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  // A real toggle, not a pass-through: Menu.Trigger has to actually open the
  // menu on press and Menu.Content has to actually stay hidden until it
  // does, or a test pressing a "destino" item would pass without ever
  // proving the student can reach it in the first place.
  const MenuContext = createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  // Declared as named, capitalised functions and only then hung on `Menu`:
  // an anonymous arrow assigned to `Menu.Trigger` is not a component name any
  // linter can see, so every `useContext` in one reads as a hook called
  // outside a component (react-hooks/rules-of-hooks) and every one of them
  // trips react/display-name.
  function Menu({ children }: any) {
    const [open, setOpen] = useState(false);
    return <MenuContext.Provider value={{ open, setOpen }}>{children}</MenuContext.Provider>;
  }
  function MenuTrigger({ children, asChild }: any) {
    const ctx = useContext(MenuContext);
    const toggle = () => ctx.setOpen(!ctx.open);
    if (asChild) {
      const child = React.Children.only(children);
      return cloneElement(child, {
        onPress: (...args: unknown[]) => {
          child.props.onPress?.(...args);
          toggle();
        },
      });
    }
    return <TouchableOpacity onPress={toggle}>{children}</TouchableOpacity>;
  }
  function MenuPortal({ children }: any) {
    const ctx = useContext(MenuContext);
    return ctx.open ? <View>{children}</View> : null;
  }
  function MenuOverlay() {
    const ctx = useContext(MenuContext);
    return <TouchableOpacity onPress={() => ctx.setOpen(false)} />;
  }
  function MenuContent({ children }: any) {
    return <View>{children}</View>;
  }
  function MenuLabel({ children }: any) {
    return <Text>{children}</Text>;
  }
  function MenuItem({ children, onPress, testID }: any) {
    const ctx = useContext(MenuContext);
    return (
      <TouchableOpacity
        testID={testID}
        onPress={() => {
          onPress?.();
          ctx.setOpen(false);
        }}
      >
        {children}
      </TouchableOpacity>
    );
  }
  function MenuItemTitle({ children }: any) {
    return <Text>{children}</Text>;
  }
  Menu.Trigger = MenuTrigger;
  Menu.Portal = MenuPortal;
  Menu.Overlay = MenuOverlay;
  Menu.Content = MenuContent;
  Menu.Label = MenuLabel;
  Menu.Item = MenuItem;
  Menu.ItemTitle = MenuItemTitle;

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

function trajetoria(
  historico: Partial<Historico>,
  marcos: MarcosSemestralizacao | null = null,
): TrajetoriaResponse {
  return {
    fetchedAt: "2026-08-19T03:35:00.000Z",
    plano: [],
    marcos,
    projecao: null,
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

/** Assembles a full TrajetoriaResponse from just the projected semestres, so
 * the projeção-focused tests below don't each repeat the whole fixture. */
function comProjecao(
  semestres: SemestreProjetado[],
  extras: Partial<ProjecaoTrajetoria> = {},
): TrajetoriaResponse {
  return {
    ...trajetoria({ cursados: [MATRICULADO] }),
    projecao: {
      semestres,
      teto: 300,
      atrasadas: 0,
      conclusaoProjetada: semestres[semestres.length - 1]?.semestre ?? "2026.2",
      semestresAlemDoPrevisto: 0,
      alemDoPrazoMaximo: false,
      ...extras,
    },
  } as TrajetoriaResponse;
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

  it("desenha os semestres projetados depois dos cursados", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({
      ...trajetoria({ cursados: [MATRICULADO] }),
      projecao: {
        semestres: [
          {
            semestre: "2026.2",
            componentes: [
              {
                codigo: "MATA60",
                nome: "BANCO DE DADOS",
                cargaHoraria: 68,
                periodo: 4,
                atrasada: false,
                manual: false,
                preRequisitoNaoVerificado: false,
              },
            ],
            horasOptativas: 0,
            horasComplementares: 0,
          },
        ],
        teto: 300,
        atrasadas: 0,
        conclusaoProjetada: "2026.2",
        semestresAlemDoPrevisto: 0,
        alemDoPrazoMaximo: false,
      },
    } as TrajetoriaResponse);

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("MATA60")).toBeTruthy();
    // O balde morreu: nada mais fora da linha do tempo.
    expect(screen.queryByText("Sem período")).toBeNull();
    expect(screen.queryByText(/Ainda não salva/i)).toBeNull();
  });

  it("marca a atrasada com o período de origem dela", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([
        {
          semestre: "2026.2",
          componentes: [
            {
              codigo: "MATA60",
              nome: "BANCO DE DADOS",
              cargaHoraria: 68,
              periodo: 3,
              atrasada: true,
              manual: false,
              preRequisitoNaoVerificado: false,
            },
          ],
          horasOptativas: 0,
          horasComplementares: 0,
        },
      ]),
    );

    await render(<TrajetoriaTab />);

    // O selo viaja junto do card: espalhar o atraso não pode escondê-lo.
    expect(await screen.findByText("atrasada · 3º período")).toBeTruthy();
  });

  it("resume o atraso acima da linha do tempo", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([], {
        atrasadas: 5,
        conclusaoProjetada: "2028.2",
        semestresAlemDoPrevisto: 2,
      }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/5 obrigatórias atrasadas/)).toBeTruthy();
    // Duas ocorrências agora, e as duas propositais: a frase de resumo e a
    // linha de chegada, que passou a marcar o semestre.
    expect(screen.getAllByText(/2028\.2/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 semestres além do previsto/)).toBeTruthy();
    expect(screen.getByTestId("conclusao-projetada").props.children).toBe("2028.2");
  });

  it("diz quando o aluno em dia conclui, sem nenhuma atrasada na tela", async () => {
    // O caso que não aparecia em lugar nenhum: 0 atrasadas escondia a frase de
    // resumo inteira, e o card da bandeira só dizia "Linha de chegada".
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([], { atrasadas: 0, conclusaoProjetada: "2029.1" }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/Neste ritmo você conclui em 2029\.1/)).toBeTruthy();
    expect(screen.getByTestId("conclusao-projetada").props.children).toBe("2029.1");
    expect(screen.queryByText(/atrasada/)).toBeNull();
  });

  it("mostra as horas genéricas como bloco, não como card", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([
        {
          semestre: "2026.2",
          componentes: [],
          horasOptativas: 120,
          horasComplementares: 60,
        },
      ]),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText("120 h de optativas")).toBeTruthy();
    // Complementar é estágio/monitoria: nunca vai ser escolhível numa lista, e
    // chamá-la de optativa prometeria uma tela de escolha que não vai existir.
    expect(screen.getByText("60 h de atividades complementares")).toBeTruthy();
    // Não é matéria, então não é card — o único materia-card na tela continua
    // sendo o da matéria cursada que o fixture já trazia (MATA55).
    expect(screen.queryAllByTestId(/^materia-card-/)).toHaveLength(1);
  });

  it("avisa quando a projeção passa do prazo máximo", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([], { alemDoPrazoMaximo: true, conclusaoProjetada: "2031.1" }),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByText(/prazo máximo/i)).toBeTruthy();
  });

  const BANCO_PROJETADO = {
    codigo: "MATA60",
    nome: "BANCO DE DADOS",
    cargaHoraria: 68,
    periodo: 4,
    atrasada: false,
    manual: false,
    preRequisitoNaoVerificado: false,
  };

  /** MATA60 em `semestre`, e sempre dois semestres para haver destino de menu. */
  function comBancoEm(semestre: "2026.2" | "2027.1"): TrajetoriaResponse {
    return comProjecao([
      {
        semestre: "2026.2",
        componentes: semestre === "2026.2" ? [BANCO_PROJETADO] : [],
        horasOptativas: 0,
        horasComplementares: 0,
      },
      {
        semestre: "2027.1",
        componentes: semestre === "2027.1" ? [{ ...BANCO_PROJETADO, manual: true }] : [],
        horasOptativas: 0,
        horasComplementares: 0,
      },
    ]);
  }

  it("mover uma matéria salva a posição e aplica a trajetória que volta", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));
    jest.mocked(putPlano).mockResolvedValue(comBancoEm("2027.1"));

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    // The card body and the "mover" icon are two separate Pressables now —
    // opening the menu is its own step, not implied by the destino being on
    // screen. Only after that does the destino become pressable — and it has
    // its own testID because "2027.1" is now written in three places on this
    // screen: the semestre header, the menu option, and the linha de chegada.
    await act(async () => {
      fireEvent.press(screen.getByTestId("mover-MATA60"));
    });
    // Pressing the icon must not also fire the card's own onPress — the two
    // gestures used to be the same Pressable, which opened the menu and
    // navigated to the árvore de dependências in the same tap.
    expect(mockRouterPush).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId("destino-MATA60-2027.1"));
    });

    expect(jest.mocked(putPlano)).toHaveBeenCalledWith("token", [
      { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 68, semestre: "2027.1" },
    ]);
  });

  it("oferece tirar do plano a matéria que o aluno moveu, mandando semestre null", async () => {
    // O ramo `semestre: null` do PUT existe, está testado no backend e era
    // inalcançável pelo app: sem esta opção a matéria fica manual para sempre.
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2027.1"));
    jest.mocked(putPlano).mockResolvedValue(comBancoEm("2026.2"));

    await render(<TrajetoriaTab />);
    // MATA60 está em 2027.1, e só o ano do período em curso (2026) abre
    // sozinho — o card só existe depois de expandir 2027.
    await act(async () => {
      fireEvent.press(await screen.findByTestId("ano-2027"));
    });
    await screen.findByText("MATA60");

    await act(async () => {
      fireEvent.press(screen.getByTestId("mover-MATA60"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("tirar-do-plano-MATA60"));
    });

    expect(jest.mocked(putPlano)).toHaveBeenCalledWith("token", [
      { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 68, semestre: null },
    ]);
  });

  it("não oferece tirar do plano o que o plano nunca pôs", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    await act(async () => {
      fireEvent.press(screen.getByTestId("mover-MATA60"));
    });

    // O menu abriu — o destino está lá — e mesmo assim não há o que desfazer.
    expect(screen.getByTestId("destino-MATA60-2027.1")).toBeTruthy();
    expect(screen.queryByTestId("tirar-do-plano-MATA60")).toBeNull();
  });

  it("toque no corpo do card projetado abre a árvore de dependências", async () => {
    // O lado positivo da separação dos gestos: o teste do "mover" prova que o
    // ícone não navega, este prova que o corpo do card ainda navega.
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    await act(async () => {
      fireEvent.press(screen.getByTestId("card-projetado-MATA60"));
    });

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA60", nome: "BANCO DE DADOS" },
    });
  });

  it("não colide com o card cursado quando a mesma matéria aparece nos dois", async () => {
    // Uma reprovada está no histórico e nas pendentes ao mesmo tempo: com o
    // prefixo de testID compartilhado, getByTestId("materia-card-MATA55")
    // passava a lançar por duplicidade.
    jest.mocked(getTrajetoria).mockResolvedValue(
      comProjecao([
        {
          semestre: "2026.2",
          componentes: [
            {
              codigo: "MATA55",
              nome: "SISTEMAS OPERACIONAIS",
              cargaHoraria: 68,
              periodo: 4,
              atrasada: false,
              manual: false,
              preRequisitoNaoVerificado: false,
            },
          ],
          horasOptativas: 0,
          horasComplementares: 0,
        },
      ]),
    );

    await render(<TrajetoriaTab />);

    expect(await screen.findByTestId("materia-card-MATA55")).toBeTruthy();
    expect(screen.getByTestId("card-projetado-MATA55")).toBeTruthy();
  });

  it("mostra o erro quando o salvamento falha, sem perder a trajetória carregada", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));
    jest.mocked(putPlano).mockRejectedValue(new ApiError("Unauthorized", 401));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    await act(async () => {
      fireEvent.press(screen.getByTestId("mover-MATA60"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("destino-MATA60-2027.1"));
    });

    expect(await screen.findByText("Credenciais inválidas")).toBeTruthy();
    // The trajectory itself must still be there — a failed move is an inline
    // warning, not a full-page error that throws away what was loaded.
    expect(screen.getByText("MATA60")).toBeTruthy();
    consoleWarn.mockRestore();
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

  it("abre o ano do histórico, não o ano projetado, quando não há nada em curso", async () => {
    // LOGICA fecha 2025 já concluído — nada `emCurso` em todo o histórico —
    // e a projeção acrescenta um ano futuro (2027). Sem a correção, o ano
    // aberto por padrão seria o último da lista (2027, só projetado) em vez
    // do último ano com períodos (2025).
    jest.mocked(getTrajetoria).mockResolvedValue({
      ...trajetoria({ cursados: [LOGICA] }),
      projecao: {
        semestres: [
          {
            semestre: "2027.1",
            componentes: [
              {
                codigo: "MATA60",
                nome: "BANCO DE DADOS",
                cargaHoraria: 68,
                periodo: 4,
                atrasada: false,
                manual: false,
                preRequisitoNaoVerificado: false,
              },
            ],
            horasOptativas: 0,
            horasComplementares: 0,
          },
        ],
        teto: 300,
        atrasadas: 0,
        conclusaoProjetada: "2027.1",
        semestresAlemDoPrevisto: 0,
        alemDoPrazoMaximo: false,
      },
    } as TrajetoriaResponse);

    await render(<TrajetoriaTab />);

    // O ano do histórico (2025) está aberto: sua matéria aparece direto.
    expect(await screen.findByText("MATA37")).toBeTruthy();
    // O ano só-projetado (2027) começa fechado.
    expect(screen.queryByText("MATA60")).toBeNull();
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
