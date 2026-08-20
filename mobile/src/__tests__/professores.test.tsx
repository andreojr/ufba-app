import { render, screen, waitFor } from "@testing-library/react-native";

import ProfessoresScreen from "@/app/(tabs)/professores";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocenteResumo, Turma } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postDocentesSemestre: jest.fn(),
}));

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

// The global header pulls in Avatar, auth and routing of its own; this screen's
// tests are about the list, not the chrome.
jest.mock("@/components/AppBar", () => ({ AppBar: () => null }));

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

function resumo(nome: string, perfil: DocenteResumo["perfil"]): DocenteResumo {
  return { nomeOriginal: nome, componentes: [{ codigo: "MATA65", nome: "CG" }], perfil };
}

function turma(codigo: string, nome: string, docente: string | null): Turma {
  return {
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
    mockedSchedule.mockResolvedValue({
      turmas: [
        turma("MATA65", "CG", "FULANO DE TAL"),
        turma("MATA59", "SEM DOCENTE", null),
      ],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
  });

  it("warns that the first load goes to SIGAA, so a long wait is not a hang", async () => {
    mockedPost.mockReturnValue(new Promise(() => {}));
    await render(<ProfessoresScreen />);
    expect(await screen.findByText(/só na primeira vez/i)).toBeTruthy();
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
  it("points the user at Início when the schedule was never synced", async () => {
    mockedSchedule.mockResolvedValue({ sincronizado: false });
    await render(<ProfessoresScreen />);
    expect(await screen.findByText(/sincronizar sua grade/i)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("offers a retry when the request fails", async () => {
    mockedPost.mockRejectedValue(new Error("boom"));
    await render(<ProfessoresScreen />);
    expect(await screen.findByText(/tentar novamente/i)).toBeTruthy();
  });
});
