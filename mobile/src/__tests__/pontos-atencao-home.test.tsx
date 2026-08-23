import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { getPontosAtencao, getSchedule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { useSyncFreshness } from "@/lib/sync-freshness-context";
import type { PontoAtencao } from "@/lib/types";

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
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedGetPontosAtencao = jest.mocked(getPontosAtencao);

/** Nada de turmas — os testes desta suíte não olham para a grade semanal. */
function scheduleVazio() {
  return { turmas: [], periodoLetivo: null, fetchedAt: "2026-08-24T10:00:00.000Z" };
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
}: {
  pontos: PontoAtencao[];
  diaSelecionado?: number;
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
  mockedGetSchedule.mockResolvedValue(scheduleVazio());
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
      pontos: [pontoFalso({ id: "p1", data: "2026-08-27", titulo: "Relatório final" })],
    });

    // toHaveTextContent faz match exato por padrão — o herói concatena vários
    // Text (dias, chip, título, código), então as checagens usam exact: false,
    // igual às outras asserções de conteúdo composto neste arquivo de testes.
    const hero = getByTestId("pontos-atencao-hero");
    expect(hero).toHaveTextContent("3", { exact: false });
    expect(hero).toHaveTextContent("Relatório final", { exact: false });
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
});
