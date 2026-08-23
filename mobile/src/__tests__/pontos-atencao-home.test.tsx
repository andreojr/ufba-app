import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useFocusEffect } from "expo-router";

import { getPontosAtencao, getSchedule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { SCHEDULE_PALETTE } from "@/lib/sigaa-schedule";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import type { PontoAtencao, Turma } from "@/lib/types";

import HomeTab from "@/screens/HomeTab";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/sync-freshness-context", () => ({
  ...jest.requireActual("@/lib/sync-freshness-context"),
  useSyncFreshness: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postScheduleSync: jest.fn(),
  getPontosAtencao: jest.fn(),
}));
jest.mock("@/lib/periodo-cache", () => ({
  savePeriodoCache: jest.fn().mockResolvedValue(undefined),
  getPeriodoCache: jest.fn().mockResolvedValue(null),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => {
  const react = jest.requireActual("react");
  return {
    ...jest.requireActual("expo-router"),
    // useFocusEffect real exige um NavigationContainer, que estes testes não
    // montam. Roda o callback na montagem (real o bastante pro fluxo normal)
    // e expõe um jest.fn() pra os testes de refoco chamarem o callback de
    // novo, simulando a tela voltando ao foco sem navegação de verdade.
    useFocusEffect: jest.fn((callback: () => void) => {
      react.useEffect(() => {
        const limpeza = callback();
        return typeof limpeza === "function" ? limpeza : undefined;
      }, []);
    }),
  };
});

jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  const Popover = Object.assign(({ children }: any) => <View>{children}</View>, {
    Trigger: ({ children }: any) => <View>{children}</View>,
    Portal: ({ children }: any) => <View>{children}</View>,
    Overlay: () => null,
    Content: ({ children }: any) => <View>{children}</View>,
    Title: ({ children }: any) => <Text>{children}</Text>,
    Description: ({ children }: any) => <Text>{children}</Text>,
  });

  return {
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
    Button: Object.assign(
      ({ children, onPress, isDisabled }: any) => (
        <TouchableOpacity onPress={onPress} disabled={isDisabled} accessibilityRole="button">
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </TouchableOpacity>
      ),
      { Label: ({ children }: any) => <Text>{children}</Text> },
    ),
    Spinner: () => <Text>Carregando spinner</Text>,
    Popover,
    Typography: {
      Heading: ({ children, ...props }: any) => <Text {...props}>{children}</Text>,
      Paragraph: ({ children, ...props }: any) => <Text {...props}>{children}</Text>,
    },
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  const actual = jest.requireActual("react-native-svg");
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    SvgUri: ({ uri, testID }: any) => <Text testID={testID} uri={uri} />,
  };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseFocusEffect = jest.mocked(useFocusEffect);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedGetPontosAtencao = jest.mocked(getPontosAtencao);

/** Nada de turmas — os testes desta suíte não olham para a grade semanal. */
function scheduleVazio() {
  return { turmas: [], periodoLetivo: null, fetchedAt: "2026-08-24T10:00:00.000Z" };
}

/** Uma turma com uma aula, para os testes que checam a cor herdada da grade. */
function turmaComAula(): Turma {
  return {
    id: "turma-1",
    numero: "01",
    codigo: "MATA37",
    nome: "SISTEMAS OPERACIONAIS",
    docente: "BEATRIZ NUNES CAMPELO",
    slots: [
      {
        dia: "Segunda",
        inicioMin: 480,
        fimMin: 540,
        predio: "PAF 1",
        sala: "208",
        localOriginal: "PAF 1 - 208",
      },
    ],
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
  };
}

function scheduleComTurma() {
  return { turmas: [turmaComAula()], periodoLetivo: null, fetchedAt: "2026-08-24T10:00:00.000Z" };
}

function pontoFalso(overrides: Partial<PontoAtencao> = {}): PontoAtencao {
  return {
    id: "p0",
    turmaId: "turma-1",
    turmaCodigo: "MATA37",
    turmaNome: "SISTEMAS OPERACIONAIS",
    tipo: "TRABALHO",
    titulo: "Prazo genérico",
    data: "2026-08-27",
    hora: null,
    observacao: null,
    responsavel: null,
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    estado: "NORMAL",
    podeEditar: false,
    podeApagar: false,
    ...overrides,
  };
}

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex"];

/**
 * Relógio fixo em segunda-feira 2026-08-24, para que um prazo em 2026-08-27
 * (quinta) fique a exatos 3 dias — mesma conta que os testes fazem à mão.
 */
function pinToMonday(): void {
  jest.useFakeTimers({ now: new Date(2026, 7, 24, 10, 0, 0), advanceTimers: true });
}

async function renderHome({
  pontos,
  diaSelecionado,
  schedule = scheduleVazio(),
}: {
  pontos: PontoAtencao[];
  diaSelecionado?: number;
  schedule?: ReturnType<typeof scheduleVazio> | ReturnType<typeof scheduleComTurma>;
}) {
  pinToMonday();
  mockedUseAuth.mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
  } as any);
  mockedUseSigaaLink.mockReturnValue({
    status: "linked",
    syncMode: "device",
    senhaDesatualizada: false,
    jaVinculou: true,
    link: jest.fn(),
    unlink: jest.fn(),
  });
  mockedGetSigaaCredentials.mockResolvedValue({
    login: "123",
    senha: "segredo",
    syncMode: "device",
  });
  mockedGetSchedule.mockResolvedValue(schedule);
  mockedGetPontosAtencao.mockResolvedValue(pontos);
  jest.mocked(useSyncFreshness).mockReturnValue({
    scheduleFetchedAt: null,
    historicoFetchedAt: null,
    setScheduleFetchedAt: jest.fn(),
    setHistoricoFetchedAt: jest.fn(),
  });

  const utils = await render(<HomeTab />);
  await waitFor(() => expect(mockedGetPontosAtencao).toHaveBeenCalled());

  if (diaSelecionado !== undefined) {
    await act(async () => {
      fireEvent.press(utils.getByTestId(`weekday-${WEEKDAY_LABELS[diaSelecionado]}`));
    });
  }

  return utils;
}

describe("PontosAtencaoSection na home", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("mostra o prazo mais próximo no card herói", async () => {
    const { getByTestId } = await renderHome({
      // turmaCodigo "MATA37" contém um "3" — se a asserção do contador caísse
      // de volta para um match solto contra o card inteiro, ela passaria
      // mesmo com diasAte quebrado. O número tem testID próprio por isso.
      pontos: [pontoFalso({ id: "p1", data: "2026-08-27", titulo: "Relatório final" })],
    });

    expect(getByTestId("pontos-atencao-hero-dias")).toHaveTextContent(/^3$/);
    // O título é o único texto do card que contém "Relatório final" — sem
    // outro campo (código, data, contador) que possa colidir com ele.
    expect(getByTestId("pontos-atencao-hero")).toHaveTextContent("Relatório final", {
      exact: false,
    });
  });

  it("mostra a linha de vazio quando não há nenhum prazo", async () => {
    const { getByTestId, queryByTestId } = await renderHome({ pontos: [] });

    expect(getByTestId("pontos-atencao-vazio")).toBeTruthy();
    expect(queryByTestId("pontos-atencao-hero")).toBeNull();
  });

  it("mantém o item contestado fora do herói e do bloco do dia", async () => {
    const { queryByTestId } = await renderHome({
      pontos: [pontoFalso({ id: "p1", estado: "CONTESTADO" })],
    });

    expect(queryByTestId("pontos-atencao-hero")).toBeNull();
    expect(queryByTestId("ponto-do-dia-p1")).toBeNull();
  });

  it("intercala o prazo do dia selecionado entre as aulas", async () => {
    const { getByTestId } = await renderHome({
      diaSelecionado: 3, // quinta
      pontos: [pontoFalso({ id: "p1", data: "2026-08-27" })],
    });

    expect(getByTestId("ponto-do-dia-p1")).toBeTruthy();
  });

  it("pinta a turma do prazo com a mesma cor que ela tem na grade semanal", async () => {
    const { getByTestId, getAllByText } = await renderHome({
      schedule: scheduleComTurma(),
      pontos: [pontoFalso({ id: "p1", turmaId: "turma-1", turmaCodigo: "MATA37" })],
    });

    // Espera a semana carregar de verdade — só então o mapa de cores lido dos
    // ScheduleBlocks (que a home passa para a seção) deixa de ser um mapa vazio.
    await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

    // Única turma da semana: buildWeekSchedule dá a ela o primeiro índice da
    // paleta. A seção lê essa cor de volta, não numera por conta própria.
    const corEsperada = SCHEDULE_PALETTE[0].bar;
    const bolinha = getByTestId("pontos-atencao-hero-cor");
    expect(bolinha.props.style).toEqual(expect.objectContaining({ backgroundColor: corEsperada }));
  });

  it("refaz a busca dos pontos quando a Home volta ao foco, sem refazer o horário", async () => {
    await renderHome({ pontos: [pontoFalso({ id: "p1" })] });
    mockedGetPontosAtencao.mockClear();
    mockedGetSchedule.mockClear();

    // Simula um novo foco (voltar do cadastro/edição/exclusão/correção de um
    // ponto de atenção) invocando o callback capturado pelo mock de
    // useFocusEffect, sem precisar de um NavigationContainer de verdade.
    const ultimaChamada =
      mockedUseFocusEffect.mock.calls[mockedUseFocusEffect.mock.calls.length - 1];
    await act(async () => {
      ultimaChamada[0]();
    });

    await waitFor(() => expect(mockedGetPontosAtencao).toHaveBeenCalledTimes(1));
    // O horário é caro (pode disparar sync de verdade no SIGAA) e não muda
    // com essas ações — só os pontos devem recarregar a cada foco.
    expect(mockedGetSchedule).not.toHaveBeenCalled();
  });
});
