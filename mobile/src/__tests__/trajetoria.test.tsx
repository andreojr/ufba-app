import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TrajetoriaTab from "@/app/(tabs)/trajetoria";
import { getTrajetoria, postTrajetoriaSync } from "@/lib/api";
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
// Menu, Button and useThemeColor.
jest.mock("heroui-native", () => {
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

  return {
    Menu,
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
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

    // Two decimals: the CR, not a grade — formatarNota would print 8,2 here.
    expect(await screen.findByText("8,16")).toBeTruthy();
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
