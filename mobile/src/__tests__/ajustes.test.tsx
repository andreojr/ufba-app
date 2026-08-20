import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { useUniwind } from "uniwind";

import { ApiError, getSchedule, postScheduleSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "@/lib/calendar-export";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { saveThemePreference } from "@/lib/theme-preference";
import type { PeriodoLetivo, Turma } from "@/lib/types";

import AjustesTab from "@/app/(tabs)/ajustes";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/theme-preference", () => ({
  saveThemePreference: jest.fn().mockResolvedValue(undefined),
}));

const mockUniwindSetTheme = jest.fn();
jest.mock("uniwind", () => ({
  useUniwind: jest.fn(),
  Uniwind: { setTheme: (...args: unknown[]) => mockUniwindSetTheme(...args) },
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  // Defaults to the never-synced state: most tests in this file have nothing
  // to say about the schedule, and a bare jest.fn() resolving to undefined
  // breaks the screen's mount-time cache read.
  getSchedule: jest.fn().mockResolvedValue({ sincronizado: false }),
  postScheduleSync: jest.fn(),
}));
jest.mock("@/lib/calendar-export", () => {
  const actual = jest.requireActual("@/lib/calendar-export");
  return {
    ...actual,
    exportScheduleToDeviceCalendar: jest.fn(),
  };
});

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockToastShow = jest.fn();

jest.mock("heroui-native", () => {
  const React = jest.requireActual("react");
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  // Minimal stand-in for the real compound Tabs: a context carries the
  // controlled value/onValueChange down to each Trigger, which fires it on press.
  const TabsContext = React.createContext<{ value?: string; onValueChange?: (value: string) => void }>({});

  const Tabs = Object.assign(
    ({ children, value, onValueChange }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <View>{children}</View>
      </TabsContext.Provider>
    ),
    {
      List: ({ children }: any) => <View>{children}</View>,
      Indicator: () => null,
      Trigger: ({ value, children, testID }: any) => {
        const ctx = React.useContext(TabsContext);
        const isSelected = ctx.value === value;
        return (
          <TouchableOpacity
            testID={testID}
            accessibilityState={{ selected: isSelected }}
            onPress={() => ctx.onValueChange?.(value)}
          >
            {typeof children === "function" ? children({ isSelected, value }) : children}
          </TouchableOpacity>
        );
      },
      Label: ({ children }: any) => <Text>{children}</Text>,
    }
  );

  return {
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Tabs,
    ListGroup: Object.assign(({ children }: any) => <View>{children}</View>, {
      Item: ({ children, onPress, disabled, testID }: any) => (
        <TouchableOpacity testID={testID} onPress={onPress} disabled={disabled}>
          {children}
        </TouchableOpacity>
      ),
      ItemPrefix: ({ children }: any) => <View>{children}</View>,
      ItemSuffix: ({ children }: any) => <View>{children}</View>,
      ItemContent: ({ children }: any) => <View>{children}</View>,
      ItemTitle: ({ children }: any) => <Text>{children}</Text>,
      ItemDescription: ({ children }: any) => <Text>{children}</Text>,
    }),
    Spinner: () => <Text>Carregando spinner</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    // Minimal stand-in for the real compound Toast — dangerToast() (see
    // @/lib/toast-helpers) renders through this via the "custom component"
    // toast.show() pattern, so tests can render what was passed to it.
    Toast: Object.assign(({ children }: any) => <View>{children}</View>, {
      Title: ({ children }: any) => <Text testID="toast-title">{children}</Text>,
      Description: ({ children }: any) => <Text testID="toast-description">{children}</Text>,
    }),
    useThemeColor: () => "#000000",
    useToast: () => ({ toast: { show: mockToastShow } }),
  };
});

/** Renders the last toast.show() call's `component` (see @/lib/toast-helpers's
 * dangerToast) and returns its title text — the danger toast's actual visible
 * content, since it no longer passes a plain `{ variant, label }` object. */
async function lastDangerToastText(): Promise<string> {
  const [options] = mockToastShow.mock.calls[mockToastShow.mock.calls.length - 1];
  const { getByTestId } = await render(options.component({ id: "toast", hide: jest.fn() }));
  return getByTestId("toast-title").props.children;
}

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  const actual = jest.requireActual("react-native-svg");
  // Only SvgUri needs stubbing (it resolves a network URI, unsuitable for tests) —
  // everything else (Svg, Path, Defs, gradients...) stays real so MoodleIcon and
  // ClassroomIcon, which render plain <Svg>/<Path> trees, still work here. `__esModule`
  // must be carried over explicitly: it's non-enumerable on the real module, so the
  // spread below silently drops it, and Babel's default-import interop then wraps this
  // whole mock object as `Svg`'s value instead of unwrapping `actual.default`.
  return { ...actual, __esModule: true, SvgUri: ({ uri, testID }: any) => <Text testID={testID} uri={uri} /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedPostScheduleSync = jest.mocked(postScheduleSync);
const mockedExportScheduleToDeviceCalendar = jest.mocked(exportScheduleToDeviceCalendar);
const mockedUseUniwind = jest.mocked(useUniwind);
const mockedSaveThemePreference = jest.mocked(saveThemePreference);

const mockRefreshUser = jest.fn();

const PERIODO_LETIVO: PeriodoLetivo = {
  semestre: "2026.2",
  inicio: "2026-08-19",
  fim: "2026-12-19",
};

function turma(): Turma {
  return {
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

function mockSignedIn(userOverrides: Record<string, unknown> = {}) {
  mockedUseAuth.mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: {
      id: "1",
      email: "ana.carvalho@ufba.br",
      name: "Ana Carvalho",
      avatarUrl: null,
      ...userOverrides,
    },
    signIn: jest.fn(),
    signOut: jest.fn(),
    refreshUser: mockRefreshUser,
  } as any);
}

describe("AjustesTab", () => {
  beforeEach(() => {
    mockRefreshUser.mockClear();
    mockToastShow.mockClear();
    mockedGetSchedule.mockClear();
    mockedPostScheduleSync.mockClear();
    mockedExportScheduleToDeviceCalendar.mockClear();
    mockUniwindSetTheme.mockClear();
    mockedSaveThemePreference.mockClear();
    mockedUseUniwind.mockReturnValue({ theme: "light", hasAdaptiveThemes: false });
    mockSignedIn();
  });

  it("shows the signed-in user's name and email", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<AjustesTab />);

    expect(getByText("Ana Carvalho")).toBeTruthy();
    expect(getByText("ana.carvalho@ufba.br")).toBeTruthy();
    expect(getByText("AC")).toBeTruthy();
  });

  it("navigates to the avatar picker when the avatar is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<AjustesTab />);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-touchable"));
    });

    expect(mockPush).toHaveBeenCalledWith("/avatar-picker");
  });

  it("shows the chosen avatar image when the user has one", async () => {
    mockSignedIn({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<AjustesTab />);

    expect(getByTestId("avatar-image")).toBeTruthy();
  });

  it("shows an inviting call-to-action to pick an avatar when the user doesn't have one yet", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId, getByText } = await render(<AjustesTab />);

    expect(getByTestId("avatar-cta")).toBeTruthy();
    expect(getByText("Experimente")).toBeTruthy();
  });

  it("navigates to the avatar picker when the avatar call-to-action is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<AjustesTab />);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-cta"));
    });

    expect(mockPush).toHaveBeenCalledWith("/avatar-picker");
  });

  it("hides the avatar call-to-action once the user already has an avatar", async () => {
    mockSignedIn({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/svg?seed=abc" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { queryByTestId } = await render(<AjustesTab />);

    expect(queryByTestId("avatar-cta")).toBeNull();
  });

  it("shows 'Não vinculado' when the SIGAA account isn't linked", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<AjustesTab />);

    expect(getByText("Não vinculado")).toBeTruthy();
  });

  it("shows the cloud sync message when linked with syncMode cloud", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "cloud",
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText } = await render(<AjustesTab />);

    expect(getByText("Vinculado · sincronizado na nuvem")).toBeTruthy();
  });

  it("shows the device-only message when linked with syncMode device", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText } = await render(<AjustesTab />);

    expect(getByText("Vinculado · somente neste aparelho")).toBeTruthy();
  });

  it("refreshes the user profile when the screen mounts", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    await render(<AjustesTab />);

    expect(mockRefreshUser).toHaveBeenCalled();
  });

  it("shows the matrícula next to the email when the user has one", async () => {
    mockSignedIn({ matricula: "223116037" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<AjustesTab />);

    expect(getByText(/223116037/)).toBeTruthy();
  });

  it("shows the academic card with curso, ingresso and tempo na UFBA", async () => {
    mockSignedIn({
      matricula: "223116037",
      curso: "ENGENHARIA DE COMPUTAÇÃO/PGCOMP - SALVADOR - Presencial - MT - BACHARELADO",
      periodoIngresso: "2022.1",
    });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId, getByText, queryByText } = await render(<AjustesTab />);

    expect(getByTestId("academic-card")).toBeTruthy();
    // Only the course name proper — unit/city/shift details after the slash stay hidden.
    expect(getByText("ENGENHARIA DE COMPUTAÇÃO")).toBeTruthy();
    expect(queryByText(/PGCOMP/)).toBeNull();
    expect(getByText("2022.1")).toBeTruthy();
    expect(getByText(/\d+º semestre/)).toBeTruthy();
  });

  it("hides the academic card while no academic info was captured yet", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { queryByTestId } = await render(<AjustesTab />);

    expect(queryByTestId("academic-card")).toBeNull();
  });

  it("shows Perfil as the screen title, not Ajustes", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByText, queryByText } = await render(<AjustesTab />);

    expect(getByText("Perfil")).toBeTruthy();
    expect(queryByText("Ajustes")).toBeNull();
  });

  it("navigates to documentos when 'Meus documentos' is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<AjustesTab />);

    await act(async () => {
      fireEvent.press(getByTestId("documentos-item"));
    });

    expect(mockPush).toHaveBeenCalledWith("/documentos");
  });

  describe("exportar horário para o calendário", () => {
    it("blocks the export item when the SIGAA account isn't linked", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

      const { getByTestId, getByText } = await render(<AjustesTab />);

      expect(getByTestId("export-calendar-item").props.accessibilityState?.disabled).toBe(true);
      expect(getByText("Vincule sua conta do SIGAA para exportar")).toBeTruthy();
    });

    it("enables the export item once the account is linked", async () => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        link: jest.fn(),
        unlink: jest.fn(),
      });

      const { getByTestId } = await render(<AjustesTab />);

      expect(getByTestId("export-calendar-item").props.accessibilityState?.disabled).toBeFalsy();
    });

    describe("linked", () => {
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
        mockedGetSchedule.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });
        mockedExportScheduleToDeviceCalendar.mockResolvedValue(1);
      });

      it("exports the cached schedule to the device calendar when pressed, without re-scraping SIGAA", async () => {
        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() =>
          expect(mockedExportScheduleToDeviceCalendar).toHaveBeenCalledWith(
            [turma()],
            PERIODO_LETIVO
          )
        );
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.objectContaining({ variant: "success" })
        );
        expect(mockedPostScheduleSync).not.toHaveBeenCalled();
      });

      it("syncs once before exporting when nothing is cached yet", async () => {
        mockedGetSchedule.mockResolvedValue({ sincronizado: false });
        mockedPostScheduleSync.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() =>
          expect(mockedExportScheduleToDeviceCalendar).toHaveBeenCalledWith(
            [turma()],
            PERIODO_LETIVO
          )
        );
      });

      it("shows a toast instead of exporting when the term isn't known yet", async () => {
        mockedGetSchedule.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: null,
          fetchedAt: new Date().toISOString(),
        });

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
        expect(await lastDangerToastText()).toMatch(/período letivo desconhecido/i);
      });

      it("shows a toast asking to enable calendar access when permission is denied", async () => {
        mockedExportScheduleToDeviceCalendar.mockRejectedValue(new CalendarPermissionDeniedError());

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toMatch(/permiss/i);
      });

      it("shows a generic error toast when fetching the schedule fails", async () => {
        mockedGetSchedule.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toBe("Credenciais inválidas");
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
      });
    });

    describe("sincronizar horário manualmente", () => {
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
        mockedGetSchedule.mockResolvedValue({ sincronizado: false });
      });

      it("blocks the sync item when the SIGAA account isn't linked", async () => {
        mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

        const { getByTestId } = await render(<AjustesTab />);

        expect(getByTestId("sync-schedule-item").props.accessibilityState?.disabled).toBe(true);
      });

      it("re-scrapes SIGAA and reports success when pressed", async () => {
        mockedPostScheduleSync.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("sync-schedule-item"));
        });

        await waitFor(() =>
          expect(mockToastShow).toHaveBeenCalledWith(
            expect.objectContaining({ variant: "success" })
          )
        );
        expect(mockedPostScheduleSync).toHaveBeenCalledWith("token", {
          login: "123",
          senha: "segredo",
        });
      });

      it("shows an error toast when the sync fails", async () => {
        mockedPostScheduleSync.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("sync-schedule-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toBe("Credenciais inválidas");
      });
    });
  });

  describe("aparência", () => {
    it("shows Claro selected when the theme is light and not following the system", async () => {
      mockedUseUniwind.mockReturnValue({ theme: "light", hasAdaptiveThemes: false });
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<AjustesTab />);

      expect(getByTestId("theme-light-trigger").props.accessibilityState?.selected).toBe(true);
      expect(getByTestId("theme-dark-trigger").props.accessibilityState?.selected).toBe(false);
    });

    it("shows Sistema selected when following the device color scheme", async () => {
      mockedUseUniwind.mockReturnValue({ theme: "dark", hasAdaptiveThemes: true });
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<AjustesTab />);

      expect(getByTestId("theme-system-trigger").props.accessibilityState?.selected).toBe(true);
    });

    it("switches to dark and persists the preference when Escuro is pressed", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<AjustesTab />);

      await act(async () => {
        fireEvent.press(getByTestId("theme-dark-trigger"));
      });

      expect(mockUniwindSetTheme).toHaveBeenCalledWith("dark");
      await waitFor(() => expect(mockedSaveThemePreference).toHaveBeenCalledWith("dark"));
    });

    it("switches back to following the system when Sistema is pressed", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<AjustesTab />);

      await act(async () => {
        fireEvent.press(getByTestId("theme-system-trigger"));
      });

      expect(mockUniwindSetTheme).toHaveBeenCalledWith("system");
      await waitFor(() => expect(mockedSaveThemePreference).toHaveBeenCalledWith("system"));
    });
  });
});
