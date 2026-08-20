import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { ApiError, getSchedule, postScheduleSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { savePeriodoCache } from "@/lib/periodo-cache";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type { PeriodoLetivo, Turma } from "@/lib/types";

import HomeTab from "@/app/(tabs)/index";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postScheduleSync: jest.fn(),
}));
// Mocked, not automocked: the screen calls `.catch()` on the returned promise,
// and a bare jest.fn() returns undefined.
jest.mock("@/lib/periodo-cache", () => ({
  savePeriodoCache: jest.fn().mockResolvedValue(undefined),
  getPeriodoCache: jest.fn().mockResolvedValue(null),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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
      // testID and className are forwarded — the real components pass them
      // through to the underlying Text, and tests query on both.
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

// Only SvgUri is stubbed (it does a real network fetch); the rest of the module
// stays real so UfbaCrest still renders.
jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  const actual = jest.requireActual("react-native-svg");
  return {
    ...actual,
    // Spreading drops __esModule/default, which UfbaCrest needs for `import Svg`.
    __esModule: true,
    default: actual.default,
    SvgUri: ({ uri, testID }: any) => <Text testID={testID} uri={uri} />,
  };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedPostScheduleSync = jest.mocked(postScheduleSync);
const mockedSavePeriodoCache = jest.mocked(savePeriodoCache);

const ALL_WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

function turmaEveryWeekday(): Turma {
  return {
    codigo: "MATA37",
    nome: "SISTEMAS OPERACIONAIS",
    docente: "BEATRIZ NUNES CAMPELO",
    slots: ALL_WEEKDAYS.map((dia) => ({
      dia,
      inicioMin: 480,
      fimMin: 540,
      predio: "PAF 1",
      sala: "208",
      localOriginal: "PAF 1 - 208",
    })),
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
  };
}

const PERIODO_LETIVO = {
  semestre: "2026.2",
  inicio: "2026-08-19",
  fim: "2026-12-19",
};

function scheduleResponse(periodoLetivo: PeriodoLetivo | null = PERIODO_LETIVO) {
  return {
    turmas: [turmaEveryWeekday()],
    periodoLetivo,
    fetchedAt: "2026-08-19T03:35:00.000Z",
  };
}

/**
 * Pins the clock to Wednesday 2026-08-19 — the term's opening day, with the
 * Monday and Tuesday of the same week falling before it. `advanceTimers` keeps
 * real time flowing so async render/waitFor still settle.
 */
function pinToOpeningDay(): void {
  jest.useFakeTimers({ now: new Date(2026, 7, 19, 10, 0, 0), advanceTimers: true });
}

/** Same Wednesday inside the term, at whatever time of day the test needs. */
function pinTo(hour: number, minute: number): void {
  jest.useFakeTimers({ now: new Date(2026, 7, 19, hour, minute, 0), advanceTimers: true });
}

describe("HomeTab", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
    } as any);
    mockPush.mockClear();
    mockedPostScheduleSync.mockClear();
    mockedSavePeriodoCache.mockClear();
  });

  it("greets the student by name in the header instead of a generic title", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText, queryByText } = await render(<HomeTab />);

    expect(queryByText("Início")).toBeNull();
    expect(getByText(/^(Bom dia|Boa tarde|Boa noite), Ana!$/)).toBeTruthy();
  });

  it("renders the student's name as its own element so it can carry the accent tint", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<HomeTab />);

    const name = getByTestId("app-bar-greeting-name");
    expect(name).toHaveTextContent("Ana");
    expect(name.props.className).toContain("text-accent");
  });

  it("shows the student's own avatar in the header when they have one", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: {
        id: "1",
        email: "a@ufba.br",
        name: "Ana Carvalho",
        avatarUrl: "https://api.dicebear.com/9.x/open-peeps/svg?seed=abc",
      },
    } as any);
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<HomeTab />);

    expect(getByTestId("app-bar-avatar-image").props.uri).toBe(
      "https://api.dicebear.com/9.x/open-peeps/svg?seed=abc",
    );
  });

  it("falls back to the student's initials in the header when there is no avatar", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "b@ufba.br", name: "Bruno Silva", avatarUrl: null },
    } as any);
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText, queryByTestId } = await render(<HomeTab />);

    expect(queryByTestId("app-bar-avatar-image")).toBeNull();
    expect(getByText("BS")).toBeTruthy();
  });

  it("opens Ajustes — not the avatar picker — when the header profile group is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<HomeTab />);

    await act(async () => {
      fireEvent.press(getByTestId("app-bar-profile"));
    });

    expect(mockPush).toHaveBeenCalledWith("/ajustes");
    expect(mockPush).not.toHaveBeenCalledWith("/avatar-picker");
  });

  it("shows a settings cog next to the header avatar", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<HomeTab />);

    expect(getByTestId("app-bar-settings-icon")).toBeTruthy();
  });

  it("shows a message asking to link the SIGAA account when unlinked", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<HomeTab />);

    expect(getByText("Vincule sua conta do SIGAA para ver sua semana.")).toBeTruthy();
  });

  it("shows a loading state while fetching the schedule", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockReturnValue(new Promise(() => {})); // never resolves

    const { getByText } = await render(<HomeTab />);

    expect(getByText("Buscando sua semana no SIGAA…")).toBeTruthy();
  });

  it("renders the fetched schedule, including a course scheduled every weekday", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedGetSchedule.mockResolvedValue(scheduleResponse());

    const { getByText, getAllByText } = await render(<HomeTab />);

    await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));
    expect(getByText("2026.2", { exact: false })).toBeTruthy();
  });

  describe("badge da próxima aula", () => {
    beforeEach(() => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        link: jest.fn(),
        unlink: jest.fn(),
      });
      mockedGetSigaaCredentials.mockResolvedValue({
        login: "123",
        senha: "segredo",
        syncMode: "device",
      });
      // turmaEveryWeekday runs 08:00–09:00 every weekday.
      mockedGetSchedule.mockResolvedValue(scheduleResponse());
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("counts down to a class that has not started yet, instead of claiming it is happening", async () => {
      pinTo(7, 30);

      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() =>
        expect(getByTestId("next-class-when")).toHaveTextContent("em 30 min"),
      );
    });

    it('says "Agora" while the class is actually running', async () => {
      pinTo(8, 15);

      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() => expect(getByTestId("next-class-when")).toHaveTextContent("Agora"));
    });

    it("still names the weekday for a class on another day", async () => {
      // 09:30 — today's class is over, so the next one is Thursday's.
      pinTo(9, 30);

      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() => expect(getByTestId("next-class-when")).toHaveTextContent("Qui"));
    });

    it("flips from the countdown to \"Agora\" as the clock reaches the start", async () => {
      pinTo(7, 58);

      const { getByTestId } = await render(<HomeTab />);
      await waitFor(() => expect(getByTestId("next-class-when")).toHaveTextContent("em 2 min"));

      await act(async () => {
        jest.advanceTimersByTime(3 * 60_000);
      });

      expect(getByTestId("next-class-when")).toHaveTextContent("Agora");
    });
  });

  describe("cabeçalho e badge do período", () => {
    beforeEach(() => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        link: jest.fn(),
        unlink: jest.fn(),
      });
      mockedGetSigaaCredentials.mockResolvedValue({
        login: "123",
        senha: "segredo",
        syncMode: "device",
      });
      mockedGetSchedule.mockResolvedValue(scheduleResponse());
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("puts the freshness beside the heading instead of on a line under it", async () => {
      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() =>
        expect(getByTestId("schedule-freshness")).toHaveTextContent(/^Atualizado /),
      );
    });

    it("drops the semester from the freshness text, which now carries it in the badge", async () => {
      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() => expect(getByTestId("schedule-freshness")).toBeTruthy());
      expect(getByTestId("schedule-freshness")).not.toHaveTextContent("2026.2");
    });

    it("shows the semester and the countdown side by side in one badge", async () => {
      pinToOpeningDay();

      const { getByTestId } = await render(<HomeTab />);

      await waitFor(() => expect(getByTestId("periodo-badge")).toBeTruthy());
      const badge = getByTestId("periodo-badge");
      expect(badge).toHaveTextContent(/2026\.2/);
      expect(badge).toHaveTextContent(/começa hoje/);
    });

    it("keeps the months at the ends of the track, outside the badge", async () => {
      pinToOpeningDay();

      const { getByText, getByTestId } = await render(<HomeTab />);

      await waitFor(() => expect(getByTestId("periodo-badge")).toBeTruthy());
      expect(getByText("ago")).toBeTruthy();
      expect(getByText("dez")).toBeTruthy();
      expect(getByTestId("periodo-badge")).not.toHaveTextContent("ago");
    });
  });

  it("keeps the grid gutter on compact round-hour labels", async () => {
    // The reference lines moved to UFBA's slot-pair boundaries, but the labels
    // deliberately did not: "09" costs a fraction of the width of "08:50", and
    // a class's exact start and end are already on its own card below.
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedGetSchedule.mockResolvedValue(scheduleResponse());

    const { getByText, getAllByText, queryByText } = await render(<HomeTab />);
    await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

    expect(getByText("09")).toBeTruthy();
    expect(getByText("11")).toBeTruthy();
    expect(queryByText("08:50")).toBeNull();
    expect(queryByText("14:50")).toBeNull();
  });

  describe("período letivo", () => {
    beforeEach(() => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        link: jest.fn(),
        unlink: jest.fn(),
      });
      mockedGetSigaaCredentials.mockResolvedValue({
        login: "123",
        senha: "segredo",
        syncMode: "device",
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("counts the term down on the schedule grid", async () => {
      pinToOpeningDay();
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getByText } = await render(<HomeTab />);

      await waitFor(() => expect(getByText("começa hoje")).toBeTruthy());
    });

    it("marks the ends of the term track with the months it spans", async () => {
      pinToOpeningDay();
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getByText } = await render(<HomeTab />);

      await waitFor(() => expect(getByText("ago")).toBeTruthy());
      expect(getByText("dez")).toBeTruthy();
    });

    it("shows no classes on a weekday that falls before the term starts", async () => {
      // The bug: Monday the 17th listed Monday's classes even though the term
      // only opens on Wednesday the 19th.
      pinToOpeningDay();
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getByTestId, getByText, getAllByText } = await render(<HomeTab />);
      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

      await act(async () => {
        fireEvent.press(getByTestId("weekday-Seg"));
      });

      expect(getByText("Fora do período letivo.")).toBeTruthy();
    });

    it("still lists classes on a weekday inside the term", async () => {
      pinToOpeningDay();
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getByTestId, getAllByText, queryByText } = await render(<HomeTab />);
      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

      await act(async () => {
        fireEvent.press(getByTestId("weekday-Qui"));
      });

      expect(queryByText("Fora do período letivo.")).toBeNull();
      expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0);
    });

    it("keeps the whole week showing when the backend could not read the term", async () => {
      // Fallback path: no periodoLetivo means nothing to mask against, so the
      // schedule must degrade to today's behaviour rather than going blank.
      pinToOpeningDay();
      mockedGetSchedule.mockResolvedValue(scheduleResponse(null));

      const { getByTestId, getAllByText, queryByText } = await render(<HomeTab />);
      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

      await act(async () => {
        fireEvent.press(getByTestId("weekday-Seg"));
      });

      expect(queryByText("Fora do período letivo.")).toBeNull();
      expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0);
    });

    it("caches the term it just fetched, since it is the only screen that asks for one", async () => {
      // Trajetória never calls /schedule, so this write is the sole source of
      // the end date its staleness nudge reads.
      mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
      mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "s", syncMode: "device" });
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getAllByText } = await render(<HomeTab />);
      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

      expect(mockedSavePeriodoCache).toHaveBeenCalledWith(PERIODO_LETIVO);
    });

    it("caches nothing when the backend could not read the term", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
      mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "s", syncMode: "device" });
      mockedGetSchedule.mockResolvedValue(scheduleResponse(null));

      const { getAllByText } = await render(<HomeTab />);
      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));

      expect(mockedSavePeriodoCache).not.toHaveBeenCalled();
    });
  });

  it("shows an error message with a retry button when the fetch fails", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "wrong", syncMode: "device" });
    mockedGetSchedule.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { getByText } = await render(<HomeTab />);

    await waitFor(() => expect(getByText("Credenciais inválidas")).toBeTruthy());
    expect(getByText("Tentar de novo")).toBeTruthy();
  });

  describe("persistência estruturada (item 2 do roadmap)", () => {
    beforeEach(() => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        link: jest.fn(),
        unlink: jest.fn(),
      });
      mockedGetSigaaCredentials.mockResolvedValue({
        login: "123",
        senha: "segredo",
        syncMode: "device",
      });
    });

    it("reads the cached schedule instead of re-scraping SIGAA on every open", async () => {
      mockedGetSchedule.mockResolvedValue(scheduleResponse());

      const { getAllByText } = await render(<HomeTab />);

      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));
      expect(mockedPostScheduleSync).not.toHaveBeenCalled();
    });

    it("syncs automatically exactly once when the user has never synced before", async () => {
      mockedGetSchedule.mockResolvedValue({ sincronizado: false });
      mockedPostScheduleSync.mockResolvedValue(scheduleResponse());

      const { getAllByText } = await render(<HomeTab />);

      await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));
      expect(mockedPostScheduleSync).toHaveBeenCalledTimes(1);
    });
  });

});
