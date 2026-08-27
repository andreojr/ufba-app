import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import ProfessoresScreen from "@/screens/ProfessoresScreen";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocenteResumo, Turma } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postDocentesSemestre: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

// Jest's jest.mock() factory rejects out-of-scope references unless the name
// is prefixed with "mock" (case-insensitive) — this name is chosen for that,
// not stylistically.
const mockToastShow = jest.fn();

// Hand-mocked, as every screen test in this codebase does. Typography is
// compound here — Typography.Heading / Typography.Paragraph.
jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
    useToast: () => ({ toast: { show: mockToastShow } }),
  };
});

const mockedPost = postDocentesSemestre as jest.MockedFunction<typeof postDocentesSemestre>;
const mockedSchedule = getSchedule as jest.MockedFunction<typeof getSchedule>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseSigaaLink = jest.mocked(useSigaaLink);

function resumo(nome: string, perfil: DocenteResumo["perfil"]): DocenteResumo {
  return { nomeOriginal: nome, componentes: [{ codigo: "MATA65", nome: "CG" }], perfil };
}

function turma(codigo: string, nome: string, docente: string | null): Turma {
  return {
    id: `turma-${codigo}`,
    numero: "01",
    codigo,
    nome,
    docente,
    slots: [],
    vigencia: { inicio: "2026-08-19", fim: "2026-12-19" },
    semestre: "2026.2",
  };
}

describe("Professores screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // useAuth's real shape has more on it; the screen only reads accessToken.
    mockedAuth.mockReturnValue({ accessToken: "token" } as ReturnType<typeof useAuth>);
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
    } as ReturnType<typeof useSigaaLink>);
    mockedSchedule.mockResolvedValue({
      turmas: [
        turma("MATA65", "CG", "FULANO DE TAL"),
        turma("MATA59", "SEM DOCENTE", null),
      ],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
  });

  // A slow response (the once-ever cold resolution) earns the toast and the
  // fixed line under the spinner — the toast dismisses itself well before a
  // cold SIGAA resolution ends, so the fixed line is what sustains the wait.
  it("warns that the first load goes to SIGAA once the wait actually crosses the threshold", async () => {
    jest.useFakeTimers();
    mockedPost.mockReturnValue(new Promise(() => {}));
    await render(<ProfessoresScreen />);

    // Below the threshold: neither the toast nor the fixed line has
    // appeared yet — the steady-state warm read never gets this far.
    expect(screen.queryByText(/só na primeira vez/i)).toBeNull();
    expect(mockToastShow).not.toHaveBeenCalled();

    // act must be async here: with fake timers on, React's own render commit
    // sits on the (mocked) scheduler queue, and only the async form flushes it.
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(await screen.findByText(/só na primeira vez/i)).toBeTruthy();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        label: expect.stringMatching(/primeira vez/i),
      }),
    );

    // Drain before switching back to real timers — React schedules its own
    // work on the (fake) timer queue, and discarding it corrupts rendering
    // for every test that runs after this one.
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  // The steady state (the whole point of the global cache): a fast response
  // must never show the "first time only" claim — not the toast, not the
  // fixed line — because for every student after the first, it's false.
  it("never warns about SIGAA when the response is fast, the everyday warm-cache case", async () => {
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);
    await render(<ProfessoresScreen />);

    expect(await screen.findByText("FULANO DE TAL")).toBeTruthy();
    expect(screen.queryByText(/só na primeira vez/i)).toBeNull();
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("renders a card per docente once resolved", async () => {
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);
    await render(<ProfessoresScreen />);
    expect(await screen.findByText("FULANO DE TAL")).toBeTruthy();
  });

  // The count-and-term line at the top of the list — omits the term when the
  // schedule has none (the portal-home fallback per ScheduleResponse).
  it("shows how many docentes were resolved and the current term", async () => {
    mockedSchedule.mockResolvedValue({
      turmas: [turma("MATA65", "CG", "FULANO DE TAL")],
      periodoLetivo: { semestre: "2026.2", inicio: "2026-08-19", fim: "2026-12-19" },
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);
    await render(<ProfessoresScreen />);
    expect(await screen.findByText("1")).toBeTruthy();
    expect(screen.getByText(/docente em/)).toBeTruthy();
    expect(screen.getByText("2026.2")).toBeTruthy();
  });

  // Three empty states that must not look alike.
  it("shows a turma whose atestado named no docente as its own muted row", async () => {
    mockedPost.mockResolvedValue([]);
    await render(<ProfessoresScreen />);
    expect(await screen.findByText(/docente não informado/i)).toBeTruthy();
    expect(screen.getByText("MATA59")).toBeTruthy();
  });

  it("never sends a turma with no docente to the backend", async () => {
    mockedPost.mockResolvedValue([]);
    await render(<ProfessoresScreen />);
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockedPost.mock.calls[0][1]).toEqual([
      { codigo: "MATA65", nome: "CG", docente: "FULANO DE TAL" },
    ]);
  });

  it("shows the full-screen empty state when there are no turmas at all", async () => {
    mockedSchedule.mockResolvedValue({
      turmas: [],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
    await render(<ProfessoresScreen />);
    expect(await screen.findByText(/nenhuma matéria/i)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  // The backend's schedule is a cached read that can legitimately be empty
  // before the student has ever synced — a different state from "no turmas".
  // The orphan states follow the same card the other three tabs use: a
  // heading, one muted line that adapts to whether an account is linked, and a
  // button that actually takes the student to the fix.
  it("offers a way to Perfil, not just an instruction, when nothing was ever synced", async () => {
    mockedSchedule.mockResolvedValue({ sincronizado: false });

    await render(<ProfessoresScreen />);

    expect(await screen.findByText("Sua lista de professores ainda não foi montada")).toBeTruthy();
    expect(
      screen.getByText(
        "Sincronize sua conta em Perfil para buscar seu horário no SIGAA e ver seus professores.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Ir para Perfil")).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("asks an unlinked student to link, not to sync something they cannot sync", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "unlinked",
      jaVinculou: true,
    } as ReturnType<typeof useSigaaLink>);
    mockedSchedule.mockResolvedValue({ sincronizado: false });

    await render(<ProfessoresScreen />);

    expect(
      await screen.findByText(
        "Vincule sua conta em Perfil para buscar seu horário no SIGAA e ver seus professores.",
      ),
    ).toBeTruthy();
  });

  it("takes the student to Perfil when the button is pressed", async () => {
    mockedSchedule.mockResolvedValue({ sincronizado: false });

    await render(<ProfessoresScreen />);
    await act(async () => {
      fireEvent.press(await screen.findByText("Ir para Perfil"));
    });

    expect(mockPush).toHaveBeenCalledWith("/ajustes");
  });

  it("offers a retry when the request fails, worded as the other tabs word it", async () => {
    mockedPost.mockRejectedValue(new Error("boom"));
    await render(<ProfessoresScreen />);
    expect(await screen.findByText("Tentar de novo")).toBeTruthy();
  });

  it("pull-to-refresh re-reads the cached schedule instead of syncing the SIGAA", async () => {
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);
    await render(<ProfessoresScreen />);
    await screen.findByText("FULANO DE TAL");

    mockedSchedule.mockClear();
    mockedPost.mockClear();
    mockedSchedule.mockResolvedValue({
      turmas: [turma("MATA65", "CG", "FULANO DE TAL")],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);

    await act(async () => {
      await screen.getByTestId("professores-scroll").props.refreshControl.props.onRefresh();
    });

    // Re-reads the schedule cache (GET) and re-resolves docentes off it — the
    // same reading path `carregar` always takes, never `syncAll`.
    expect(mockedSchedule).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
