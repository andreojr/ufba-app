import { act, fireEvent, render, screen } from "@testing-library/react-native";

import ProfessorDetalhe from "@/app/professor/[siape]";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocentePerfil } from "@/lib/types";

// React 19 no longer warns (or throws) when a state update fires on an
// already-unmounted component — it silently no-ops, which is exactly why
// asserting on the absence of a console warning is not a reliable signal
// here (confirmed empirically: it passes with or without the montadoRef
// guard). So this wraps the real useState to record every value passed to
// its setter, giving the "never updates state after unmount" test something
// concrete to assert on regardless of what React does with the call.
const mockSetEstadoCalls: unknown[] = [];
jest.mock("react", () => {
  const actualReact = jest.requireActual("react");
  return {
    ...actualReact,
    useState: (initial: unknown) => {
      const [state, setState] = actualReact.useState(initial);
      const setStateEspiado = (value: unknown) => {
        mockSetEstadoCalls.push(value);
        return setState(value);
      };
      return [state, setStateEspiado];
    },
  };
});

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getDocente: jest.fn(),
}));
// A stable jest.fn() reference (not a fresh one per useRouter() call) so
// tests can assert on it.
const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ siape: "1815041" }),
  useRouter: () => ({ back: mockRouterBack, push: jest.fn() }),
}));

// Real enough to exercise the close button — the rest of AppBar (avatar,
// settings icon) is irrelevant to this screen, which never passes those props.
jest.mock("@/components/AppBar", () => {
  const { Text, TouchableOpacity } = jest.requireActual("react-native");
  return {
    AppBar: ({ onClose }: any) =>
      onClose ? (
        <TouchableOpacity testID="app-bar-close" onPress={onClose}>
          <Text>Fechar</Text>
        </TouchableOpacity>
      ) : null,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { createContext, useContext } = jest.requireActual("react");
  const { Text, TouchableOpacity, View } = jest.requireActual("react-native");

  // A minimal stand-in for the real compound component — see trajetoria.test.tsx,
  // which mocks it the same way: just enough context to let a Trigger press flip
  // which Content is shown.
  const TabsContext = createContext({ value: "", onValueChange: (_v: string) => {} });
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
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Spinner: () => <View />,
    Tabs,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, onPress, testID }: any) => (
        <Text testID={testID} onPress={onPress}>
          {children}
        </Text>
      ),
    },
    useThemeColor: () => "#888888",
  };
});

const mockedGet = getDocente as jest.MockedFunction<typeof getDocente>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function perfil(overrides: Partial<DocentePerfil> = {}): DocentePerfil {
  return {
    siape: "1815041",
    nome: "ANTONIO LOPES APOLINARIO JUNIOR",
    departamento: "DCC",
    unidade: "IC",
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: "IC- 2012",
    telefone: "6299",
    email: "antonio.apolinario@ufba.br",
    disciplinas: [
      { semestre: "2026.2", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
      { semestre: "2026.1", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
    ],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0, mestradoConcluidas: 0,
      doutoradoAndamento: 0, doutoradoConcluidas: 0,
    },
    ...overrides,
  };
}

describe("Professor detail screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetEstadoCalls.length = 0;
    mockedAuth.mockReturnValue({ accessToken: "token" } as ReturnType<typeof useAuth>);
  });

  it("leads with contact, the field that is almost always filled", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("IC- 2012")).toBeTruthy();
    expect(screen.getByText("antonio.apolinario@ufba.br")).toBeTruthy();
  });

  it("does not show the AppBar's own close button — the professor's name sits where it would go", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("IC- 2012");

    expect(screen.queryByTestId("app-bar-close")).toBeNull();
  });

  it("closes the screen when the bottom Fechar button is pressed", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("IC- 2012");

    fireEvent.press(screen.getByText("Fechar"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("groups the courses taught by term", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("2026.2")).toBeTruthy();

    // Older terms start behind the "ver anteriores" summary — see the
    // dedicated test below.
    await act(async () => {
      fireEvent.press(screen.getByTestId("toggle-semestres-anteriores"));
    });
    expect(screen.getByText("2026.1")).toBeTruthy();
  });

  // Older terms start collapsed behind a single summary button — a docente
  // teaching for many semesters would otherwise dump one accordion header
  // per term on screen before showing a single course.
  it("hides older terms behind a single summary until it is pressed", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("2026.2");

    expect(screen.getByText("COMPUTAÇÃO GRÁFICA")).toBeTruthy();
    expect(screen.getByText("Ver 1 disciplina anterior")).toBeTruthy();
    expect(screen.queryByText("2026.1")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId("toggle-semestres-anteriores"));
    });
    expect(screen.getByText("Ocultar semestres anteriores")).toBeTruthy();
    expect(screen.getByText("2026.1")).toBeTruthy();
  });

  // The most recent term stays open; a docente teaching for many semesters
  // should not have to scroll through every past term to see the ones they
  // are grading right now.
  it("keeps the most recent term open and collapses older ones until tapped", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("2026.2");
    await act(async () => {
      fireEvent.press(screen.getByTestId("toggle-semestres-anteriores"));
    });

    // 2026.2 (current) shows its course; 2026.1 (older) is collapsed, so its
    // own course line is not on screen yet, only the term's header row.
    expect(screen.getByText("COMPUTAÇÃO GRÁFICA")).toBeTruthy();
    expect(screen.getByText("1 disciplina")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("semestre-anterior-2026.1"));
    });
    expect(await screen.findAllByText("COMPUTAÇÃO GRÁFICA")).toHaveLength(2);
  });

  // Only Contato + Disciplinas have content here (the common case, per the
  // roadmap spec) — a single extra section must not be wrapped in tabs.
  it("does not show tabs when only one extra section has content", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("2026.2");
    expect(screen.queryByText("Disciplinas")).toBeNull();
    expect(screen.queryByText("Perfil")).toBeNull();
  });

  // Two or more of Disciplinas/Perfil/Orientações having content is what
  // triggers the tabbed layout.
  it("shows tabs once two or more sections have content", async () => {
    mockedGet.mockResolvedValue(
      perfil({ formacao: ["Bacharel em Ciência da Computação"] }),
    );
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("Disciplinas")).toBeTruthy();
    expect(screen.getByText("Perfil")).toBeTruthy();
  });

  // The empty profile is the common case — the screen must not show hollow
  // section headers for data that does not exist.
  it("omits the sections with no data instead of rendering them empty", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("IC- 2012");
    expect(screen.queryByText("Formação")).toBeNull();
    expect(screen.queryByText("Áreas de interesse")).toBeNull();
    expect(screen.queryByText("Orientações")).toBeNull();
  });

  // SIGAA's "Disciplinas Ministradas" page lists one row per turma, so the
  // same codigo legitimately repeats inside a term (the captured
  // docente-disciplinas fixture has MATA40A and MATA67A twice in 2020.1,
  // differing only by horario). The line only shows codigo and nome, so the
  // extra rows are indistinguishable noise — and keying them on
  // semestre+codigo made React blow up on the duplicate key.
  it("collapses the repeated turmas of one course within a term", async () => {
    const erros = jest.spyOn(console, "error").mockImplementation(() => {});
    mockedGet.mockResolvedValue(
      perfil({
        disciplinas: [
          { semestre: "2020.1", codigo: "MATA40A", nome: "ESTRUTURAS DE DADOS E ALGORITMOS I", cargaHoraria: 68, horario: "3N12 (08/09/2020 - 18/12/2020)" },
          { semestre: "2020.1", codigo: "MATA40A", nome: "ESTRUTURAS DE DADOS E ALGORITMOS I", cargaHoraria: 68, horario: "3N12  5N12 (02/03/2020 - 11/07/2020)" },
        ],
      }),
    );
    await render(<ProfessorDetalhe />);
    await screen.findByText("2020.1");

    expect(screen.getAllByText(/MATA40A/)).toHaveLength(1);
    expect(erros.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    erros.mockRestore();
  });

  it("shows the profile extras when the docente did fill them in", async () => {
    mockedGet.mockResolvedValue(
      perfil({
        formacao: ["Bacharel em Ciência da Computação"],
        areasInteresse: ["Computação Gráfica"],
        lattesUrl: "http://lattes.cnpq.br/123",
        orientacoes: {
          mestradoAndamento: 2, mestradoConcluidas: 5,
          doutoradoAndamento: 1, doutoradoConcluidas: 0,
        },
      }),
    );
    await render(<ProfessorDetalhe />);
    // Three sections with content (Disciplinas, Perfil, Orientações) means
    // they render as tabs, defaulting to Disciplinas — Perfil's content only
    // mounts once its tab is pressed.
    expect(await screen.findByText("Orientações")).toBeTruthy();
    fireEvent.press(screen.getByText("Perfil"));
    expect(await screen.findByText("Formação")).toBeTruthy();
    expect(screen.getByText("Computação Gráfica")).toBeTruthy();
  });

  // The backend drops the student name from a TCC row, so two students on the
  // same theme in the same year arrive as byte-identical { titulo, ano }. The
  // parser no longer emits those, but profiles cached before that fix are
  // served from the DB until they go stale — this screen has to survive them.
  it("survives TCCs that arrive duplicated from a profile cached before the parser fix", async () => {
    const erros = jest.spyOn(console, "error").mockImplementation(() => {});
    mockedGet.mockResolvedValue(
      perfil({
        tccsOrientados: [
          { titulo: "Aplicações de Aprendizado de Máquina", ano: 2026 },
          { titulo: "Aplicações de Aprendizado de Máquina", ano: 2026 },
        ],
      }),
    );
    await render(<ProfessorDetalhe />);
    // Disciplinas + Orientações both have content here, so they tab —
    // defaulting to Disciplinas — and the TCC list only mounts once
    // Orientações is pressed.
    await screen.findByText("Orientações");
    fireEvent.press(screen.getByText("Orientações"));

    expect(await screen.findAllByText(/Aplicações de Aprendizado de Máquina/)).toHaveLength(1);
    expect(erros.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    erros.mockRestore();
  });

  // Mestrado and Doutorado each need to say so when empty — an omitted level
  // reads as "not loaded", not "zero", and the two must not look alike.
  it("says a level has no orientações instead of omitting it", async () => {
    mockedGet.mockResolvedValue(
      perfil({
        orientacoes: {
          mestradoAndamento: 2, mestradoConcluidas: 1,
          doutoradoAndamento: 0, doutoradoConcluidas: 0,
        },
      }),
    );
    await render(<ProfessorDetalhe />);
    await screen.findByText("Orientações");
    fireEvent.press(screen.getByText("Orientações"));

    expect(await screen.findByText("Mestrado")).toBeTruthy();
    expect(await screen.findByText("Doutorado")).toBeTruthy();
    expect(screen.getByText("Nenhuma orientação")).toBeTruthy();
  });

  it("shows an error state when the profile cannot be loaded", async () => {
    mockedGet.mockRejectedValue(new Error("boom"));
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText(/não foi possível/i)).toBeTruthy();
  });

  // The list screen already offers a retry on failure; the detail screen
  // must not be the dead end that leaves a student stuck on a transient
  // failure with no way forward but backing out of the screen entirely.
  it("offers a retry when the profile cannot be loaded, and pressing it re-fetches", async () => {
    mockedGet.mockRejectedValueOnce(new Error("boom"));
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText(/não foi possível/i)).toBeTruthy();

    mockedGet.mockResolvedValueOnce(perfil());
    await act(async () => {
      fireEvent.press(screen.getByText("Tentar novamente"));
    });

    expect(await screen.findByText("IC- 2012")).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  // Backing out of the screen while getDocente is still in flight must not
  // leave a dangling state update. The original inline effect guarded this
  // with a `cancelado` flag; extracting the fetch into `carregar` for the
  // retry button above must not lose that protection.
  it("never updates state after the screen unmounts while the fetch is still in flight", async () => {
    let resolver: ((perfil: DocentePerfil) => void) | undefined;
    mockedGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );

    const { unmount } = await render(<ProfessorDetalhe />);
    // The mount effect's own "loading" setEstado has already fired by now —
    // only calls made from here on (i.e. after unmount) are the ones that
    // would prove the guard missing.
    mockSetEstadoCalls.length = 0;

    await unmount();

    // Resolves only after the screen is gone. A missing guard calls setEstado
    // with the ready perfil right here.
    await act(async () => {
      resolver?.(perfil());
    });

    expect(mockSetEstadoCalls).toEqual([]);
  });
});
