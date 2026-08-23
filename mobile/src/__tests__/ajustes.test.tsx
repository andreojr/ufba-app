import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { useUniwind } from "uniwind";

import {
  ApiError,
  deleteAccount,
  getSchedule,
  getTrajetoria,
  postScheduleSync,
  postTrajetoriaSync,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "@/lib/calendar-export";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { clearPeriodoCache } from "@/lib/periodo-cache";
import {
  clearSigaaCredentials,
  forgetSigaaWasLinked,
  getSigaaCredentials,
} from "@/lib/sigaa-storage";
import { SyncFreshnessProvider } from "@/lib/sync-freshness-context";
import { saveThemePreference } from "@/lib/theme-preference";
import type { PeriodoLetivo, Turma } from "@/lib/types";

import AjustesTab from "@/app/(tabs)/ajustes";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/periodo-cache", () => ({
  ...jest.requireActual("@/lib/periodo-cache"),
  clearPeriodoCache: jest.fn(),
  getPeriodoCache: jest.fn().mockResolvedValue(null),
}));
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
  // to say about the schedule/histórico, and a bare jest.fn() resolving to
  // undefined breaks the screen's mount-time cache reads.
  getSchedule: jest.fn().mockResolvedValue({ sincronizado: false }),
  postScheduleSync: jest.fn(),
  getTrajetoria: jest.fn().mockResolvedValue({ sincronizado: false }),
  postTrajetoriaSync: jest.fn(),
  deleteAccount: jest.fn(),
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

  const DialogOpenContext = React.createContext(false);

  // Minimal stand-in for the real compound Tabs: a context carries the
  // controlled value/onValueChange down to each Trigger, which fires it on press.
  // Type argument moved into the value: `React` here comes from jest.requireActual,
  // so it is untyped and TS refuses type arguments on the call itself.
  const TabsContext = React.createContext(
    {} as { value?: string; onValueChange?: (value: string) => void },
  );

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
    Button: Object.assign(
      ({ children, onPress, isDisabled, testID }: any) => (
        <TouchableOpacity
          testID={testID}
          onPress={onPress}
          disabled={isDisabled}
          accessibilityRole="button"
        >
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </TouchableOpacity>
      ),
      { Label: ({ children }: any) => <Text>{children}</Text> },
    ),
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Tabs,
    ListGroup: Object.assign(({ children }: any) => <View>{children}</View>, {
      // TouchableOpacity forwards only props it knows, so the item's
      // `className` rides along on accessibilityValue to stay assertable —
      // the dimmed "unavailable" look is behaviour, not decoration.
      Item: ({ children, onPress, disabled, testID, className }: any) => (
        <TouchableOpacity
          testID={testID}
          onPress={onPress}
          disabled={disabled}
          accessibilityValue={{ text: className }}
        >
          {children}
        </TouchableOpacity>
      ),
      ItemPrefix: ({ children }: any) => <View>{children}</View>,
      ItemSuffix: ({ children }: any) => <View>{children}</View>,
      ItemContent: ({ children }: any) => <View>{children}</View>,
      ItemTitle: ({ children }: any) => <Text>{children}</Text>,
      ItemDescription: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    }),
    // Controlled Dialog: the portal renders only while open, same as the real
    // component — which is the whole behaviour these tests care about.
    Dialog: Object.assign(
      ({ children, isOpen }: any) => (
        <DialogOpenContext.Provider value={Boolean(isOpen)}>
          <View>{children}</View>
        </DialogOpenContext.Provider>
      ),
      {
        Trigger: ({ children }: any) => <View>{children}</View>,
        Portal: ({ children }: any) =>
          React.useContext(DialogOpenContext) ? <View>{children}</View> : null,
        Overlay: () => null,
        Content: ({ children }: any) => <View>{children}</View>,
        Close: ({ children }: any) => <View>{children}</View>,
        Title: ({ children }: any) => <Text>{children}</Text>,
        Description: ({ children }: any) => <Text>{children}</Text>,
      },
    ),
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
  // Renders the glyph name so a test can tell a check from an X — the
  // vínculo row's whole job is being recognizably green-check or red-X.
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
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
const mockSignOut = jest.fn();
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedGetSchedule = jest.mocked(getSchedule);
const mockedPostScheduleSync = jest.mocked(postScheduleSync);
const mockedGetTrajetoria = jest.mocked(getTrajetoria);
const mockedPostTrajetoriaSync = jest.mocked(postTrajetoriaSync);
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
    signOut: mockSignOut,
    refreshUser: mockRefreshUser,
  } as any);
}

describe("AjustesTab", () => {
  beforeEach(() => {
    mockRefreshUser.mockClear();
    mockSignOut.mockClear();
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
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText("Ana Carvalho")).toBeTruthy();
    expect(getByText("ana.carvalho@ufba.br")).toBeTruthy();
    expect(getByText("AC")).toBeTruthy();
  });

  it("navigates to the avatar picker when the avatar is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-touchable"));
    });

    expect(mockPush).toHaveBeenCalledWith("/avatar-picker");
  });

  it("shows the chosen avatar image when the user has one", async () => {
    mockSignedIn({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/png?seed=abc" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByTestId("avatar-image")).toBeTruthy();
  });

  it("shows an inviting call-to-action to pick an avatar when the user doesn't have one yet", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId, getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByTestId("avatar-cta")).toBeTruthy();
    expect(getByText("Experimente")).toBeTruthy();
  });

  it("navigates to the avatar picker when the avatar call-to-action is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-cta"));
    });

    expect(mockPush).toHaveBeenCalledWith("/avatar-picker");
  });

  it("hides the avatar call-to-action once the user already has an avatar", async () => {
    mockSignedIn({ avatarUrl: "https://api.dicebear.com/9.x/open-peeps/svg?seed=abc" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { queryByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(queryByTestId("avatar-cta")).toBeNull();
  });

  it("shows 'Não vinculado' when the SIGAA account isn't linked", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText("Não vinculado")).toBeTruthy();
  });

  it("shows the device-only message when linked, whatever the stored syncMode", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "cloud",
      senhaDesatualizada: false,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText("Vinculado · senha só neste aparelho")).toBeTruthy();
  });

  it("shows the device-only message when linked with syncMode device", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText("Vinculado · senha só neste aparelho")).toBeTruthy();
  });

  it("marks a healthy link with a green check, the state the user should remember seeing", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText, getByTestId, queryByTestId } = await render(
      <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
    );

    expect(getByTestId("vinculo-status-ok")).toBeTruthy();
    expect(queryByTestId("vinculo-status-alerta")).toBeNull();
    expect(getByText("icon:checkmark-circle")).toBeTruthy();
  });

  it("turns the same row into a red X telling the user to update the password", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: true,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByText, getByTestId, queryByTestId } = await render(
      <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
    );

    expect(getByText("Senha desatualizada · toque para atualizar")).toBeTruthy();
    expect(getByTestId("vinculo-status-alerta")).toBeTruthy();
    expect(queryByTestId("vinculo-status-ok")).toBeNull();
    expect(getByText("icon:close-circle")).toBeTruthy();
  });

  it("shows the unlinked state as a red X too", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByText, getByTestId, queryByTestId } = await render(
      <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
    );

    expect(getByText("Não vinculado")).toBeTruthy();
    expect(getByTestId("vinculo-status-alerta")).toBeTruthy();
    expect(queryByTestId("vinculo-status-ok")).toBeNull();
    expect(getByText("icon:close-circle")).toBeTruthy();
  });

  it("refreshes the user profile when the screen mounts", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(mockRefreshUser).toHaveBeenCalled();
  });

  it("shows the matrícula next to the email when the user has one", async () => {
    mockSignedIn({ matricula: "223116037" });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText(/223116037/)).toBeTruthy();
  });

  it("shows the academic card with curso, ingresso and tempo na UFBA", async () => {
    mockSignedIn({
      matricula: "223116037",
      curso: "ENGENHARIA DE COMPUTAÇÃO/PGCOMP - SALVADOR - Presencial - MT - BACHARELADO",
      periodoIngresso: "2022.1",
    });
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId, getByText, queryByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByTestId("academic-card")).toBeTruthy();
    // Only the course name proper — unit/city/shift details after the slash stay hidden.
    expect(getByText("ENGENHARIA DE COMPUTAÇÃO")).toBeTruthy();
    expect(queryByText(/PGCOMP/)).toBeNull();
    expect(getByText("2022.1")).toBeTruthy();
    expect(getByText(/\d+º semestre/)).toBeTruthy();
  });

  it("hides the academic card while no academic info was captured yet", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { queryByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(queryByTestId("academic-card")).toBeNull();
  });

  it("shows Perfil as the screen title, not Ajustes", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByText, queryByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    expect(getByText("Perfil")).toBeTruthy();
    expect(queryByText("Ajustes")).toBeNull();
  });

  it("navigates to documentos when 'Meus documentos' is pressed", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

    const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

    await act(async () => {
      fireEvent.press(getByTestId("documentos-item"));
    });

    expect(mockPush).toHaveBeenCalledWith("/documentos");
  });

  it("keeps the sync item disabled and explained while the account is unlinked", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "unlinked",
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByTestId, getByText } = await render(
      <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
    );

    expect(getByTestId("sync-profile-item").props.accessibilityState?.disabled).toBe(true);
    expect(getByText("Vincule sua conta do SIGAA para sincronizar")).toBeTruthy();
    // Dimmed the same way the "Em breve" integrations are: a dead item that
    // looks alive is worse than one that plainly reads as unavailable.
    expect(getByTestId("sync-profile-item").props.accessibilityValue?.text).toContain("opacity-50");
  });

  it("keeps the sync item at full strength while a sync is running — busy is not unavailable", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    });

    const { getByTestId } = await render(
      <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
    );

    expect(getByTestId("sync-profile-item").props.accessibilityValue?.text ?? "").not.toContain(
      "opacity-50",
    );
  });

  describe("apagar meus dados do servidor", () => {
    const LINKED = {
      status: "linked" as const,
      syncMode: "device" as const,
      senhaDesatualizada: false,
      jaVinculou: true,
      link: jest.fn(),
      unlink: jest.fn(),
    };

    beforeEach(() => {
      // This file's outer beforeEach clears mocks one by one rather than
      // globally, so the erasure spies need clearing here or a previous test's
      // successful deletion leaks into the failure case below.
      mockedUseSigaaLink.mockReturnValue(LINKED);
      jest.mocked(deleteAccount).mockReset().mockResolvedValue(undefined);
      jest.mocked(clearSigaaCredentials).mockClear();
      jest.mocked(forgetSigaaWasLinked).mockClear();
      jest.mocked(clearPeriodoCache).mockClear();
    });

    it("asks to confirm before erasing anything", async () => {
      const { getByTestId, queryByTestId, getByText } = await render(
        <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
      );

      expect(queryByTestId("confirmar-exclusao-button")).toBeNull();

      await act(async () => {
        fireEvent.press(getByTestId("apagar-dados-item"));
      });

      expect(getByTestId("confirmar-exclusao-button")).toBeTruthy();
      // Two places, each named with what goes from it. The password belongs to
      // the phone's sentence, never the server's.
      expect(getByText(/serão apagados\s+do servidor/)).toBeTruthy();
      expect(getByText(/senha do SIGAA será apagada do celular/)).toBeTruthy();
      expect(jest.mocked(deleteAccount)).not.toHaveBeenCalled();
    });

    it("erases nothing when the confirmation is dismissed", async () => {
      const { getByTestId, queryByTestId } = await render(
        <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
      );

      await act(async () => {
        fireEvent.press(getByTestId("apagar-dados-item"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("cancelar-exclusao-button"));
      });

      expect(jest.mocked(deleteAccount)).not.toHaveBeenCalled();
      expect(queryByTestId("confirmar-exclusao-button")).toBeNull();
    });

    it("erases the account once confirmed, then clears the device and signs out", async () => {
      const { getByTestId } = await render(
        <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
      );

      await act(async () => {
        fireEvent.press(getByTestId("apagar-dados-item"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("confirmar-exclusao-button"));
      });

      expect(jest.mocked(deleteAccount)).toHaveBeenCalledWith("token");
      expect(jest.mocked(clearSigaaCredentials)).toHaveBeenCalled();
      // Without this the next sign-in would be "unlinked but already
      // onboarded" — empty tabs and no prompt to link.
      expect(jest.mocked(forgetSigaaWasLinked)).toHaveBeenCalled();
      expect(jest.mocked(clearPeriodoCache)).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalled();
    });

    it("keeps the student signed in and says what went wrong when the erasure fails", async () => {
      jest.mocked(deleteAccount).mockRejectedValue(new ApiError("boom", 500));
      const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

      const { getByTestId } = await render(
        <SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>,
      );

      await act(async () => {
        fireEvent.press(getByTestId("apagar-dados-item"));
      });
      await act(async () => {
        fireEvent.press(getByTestId("confirmar-exclusao-button"));
      });

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(jest.mocked(clearSigaaCredentials)).not.toHaveBeenCalled();
      expect(mockToastShow).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });
  });

  describe("exportar horário para o calendário", () => {
    it("keeps the export available when unlinked — it exports the stored horário, not a fresh one", async () => {
      mockedUseSigaaLink.mockReturnValue({
        status: "unlinked",
        jaVinculou: true,
        link: jest.fn(),
        unlink: jest.fn(),
      });

      const { getByTestId, getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      expect(getByTestId("export-calendar-item").props.accessibilityState?.disabled).toBeFalsy();
      expect(
        getByText('Cria um calendário "UFBA" no aparelho com suas aulas do semestre'),
      ).toBeTruthy();
    });

    it("reads the cached schedule even with no account linked", async () => {
      mockedUseSigaaLink.mockReturnValue({
        status: "unlinked",
        jaVinculou: true,
        link: jest.fn(),
        unlink: jest.fn(),
      });

      await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      await waitFor(() => expect(jest.mocked(getSchedule)).toHaveBeenCalledWith("token"));
      expect(jest.mocked(getTrajetoria)).toHaveBeenCalledWith("token");
    });

    it("enables the export item once the account is linked", async () => {
      mockedUseSigaaLink.mockReturnValue({
        status: "linked",
        syncMode: "device",
        senhaDesatualizada: false,
        jaVinculou: true,
        link: jest.fn(),
        unlink: jest.fn(),
      });

      const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      expect(getByTestId("export-calendar-item").props.accessibilityState?.disabled).toBeFalsy();
    });

    describe("linked", () => {
      beforeEach(() => {
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
        mockedGetSchedule.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });
        mockedExportScheduleToDeviceCalendar.mockResolvedValue(1);
      });

      it("exports the cached schedule to the device calendar when pressed, without re-scraping SIGAA", async () => {
        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

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

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

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

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
        expect(await lastDangerToastText()).toMatch(/período letivo desconhecido/i);
      });

      it("shows a toast asking to enable calendar access when permission is denied", async () => {
        mockedExportScheduleToDeviceCalendar.mockRejectedValue(new CalendarPermissionDeniedError());

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toMatch(/permiss/i);
      });

      it("shows a generic error toast when fetching the schedule fails", async () => {
        mockedGetSchedule.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toBe("Credenciais inválidas");
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
      });
    });

    describe("sincronizar com o SIGAA (horário + histórico)", () => {
      beforeEach(() => {
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
        mockedGetSchedule.mockResolvedValue({ sincronizado: false });
        mockedGetTrajetoria.mockResolvedValue({ sincronizado: false });
      });

      it("blocks the sync item when the SIGAA account isn't linked", async () => {
        mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        expect(getByTestId("sync-profile-item").props.accessibilityState?.disabled).toBe(true);
      });

      it("discloses what is kept and what is discarded before the first histórico sync", async () => {
        // Moved here from Trajetória's old first-sync screen: pressing sync
        // now always fetches the histórico too, so the disclosure belongs
        // wherever that press actually lives.
        const { getByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        expect(await getByText(/O que fica guardado/i)).toBeTruthy();
        expect(getByText(/matérias, notas e carga horária/i)).toBeTruthy();
        expect(getByText(/O que não fica/i)).toBeTruthy();
        expect(getByText(/CPF, RG e data de nascimento/i)).toBeTruthy();
      });

      it("hides the disclosure once the histórico has already been synced", async () => {
        mockedGetTrajetoria.mockResolvedValue({
          historico: {} as any,
          fetchedAt: new Date().toISOString(),
          plano: [],
          marcos: null,
        });

        const { queryByText } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await waitFor(() => expect(queryByText(/O que fica guardado/i)).toBeNull());
      });

      it("re-scrapes both the schedule and the histórico and reports success when pressed", async () => {
        mockedPostScheduleSync.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });
        mockedPostTrajetoriaSync.mockResolvedValue({
          historico: {
            indices: { cr: null, iap: null },
            cursados: [],
            pendentesObrigatorios: [],
            cargaHoraria: {
              obrigatorias: { exigida: 0, integralizada: 0, pendente: 0 },
              optativas: { exigida: 0, integralizada: 0, pendente: 0 },
              complementares: { exigida: 0, integralizada: 0, pendente: 0 },
              total: { exigida: 0, integralizada: 0, pendente: 0 },
            },
          } as any,
          fetchedAt: new Date().toISOString(),
          plano: [],
          marcos: null,
        });

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("sync-profile-item"));
        });

        await waitFor(() =>
          expect(mockToastShow).toHaveBeenCalledWith(
            expect.objectContaining({ variant: "success" })
          )
        );
        expect(mockedPostScheduleSync).toHaveBeenCalledWith("token", { login: "123", senha: "segredo" });
        expect(mockedPostTrajetoriaSync).toHaveBeenCalledWith("token", { login: "123", senha: "segredo" });
      });

      it("reports a partial failure when only the histórico sync fails", async () => {
        mockedPostScheduleSync.mockResolvedValue({
          turmas: [turma()],
          periodoLetivo: PERIODO_LETIVO,
          fetchedAt: new Date().toISOString(),
        });
        mockedPostTrajetoriaSync.mockRejectedValue(new ApiError("Falha no histórico", 500));

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("sync-profile-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toBe(
          "Horário sincronizado, mas o histórico não pôde ser atualizado. Pode ser um problema no documento. Você ainda pode baixar o PDF em Meus documentos."
        );
      });

      it("shows a generic error toast when both syncs fail", async () => {
        mockedPostScheduleSync.mockRejectedValue(new ApiError("Credenciais inválidas", 401));
        mockedPostTrajetoriaSync.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

        const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

        await act(async () => {
          fireEvent.press(getByTestId("sync-profile-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(await lastDangerToastText()).toBe("Credenciais inválidas");
      });
    });
  });

  describe("aparência", () => {
    it("shows Claro selected when the theme is light and not following the system", async () => {
      mockedUseUniwind.mockReturnValue({ theme: "light", hasAdaptiveThemes: false });
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      expect(getByTestId("theme-light-trigger").props.accessibilityState?.selected).toBe(true);
      expect(getByTestId("theme-dark-trigger").props.accessibilityState?.selected).toBe(false);
    });

    it("shows Sistema selected when following the device color scheme", async () => {
      mockedUseUniwind.mockReturnValue({ theme: "dark", hasAdaptiveThemes: true });
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      expect(getByTestId("theme-system-trigger").props.accessibilityState?.selected).toBe(true);
    });

    it("switches to dark and persists the preference when Escuro is pressed", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      await act(async () => {
        fireEvent.press(getByTestId("theme-dark-trigger"));
      });

      expect(mockUniwindSetTheme).toHaveBeenCalledWith("dark");
      await waitFor(() => expect(mockedSaveThemePreference).toHaveBeenCalledWith("dark"));
    });

    it("switches back to following the system when Sistema is pressed", async () => {
      mockedUseSigaaLink.mockReturnValue({ status: "unlinked", jaVinculou: true, link: jest.fn(), unlink: jest.fn() });

      const { getByTestId } = await render(<SyncFreshnessProvider><AjustesTab /></SyncFreshnessProvider>);

      await act(async () => {
        fireEvent.press(getByTestId("theme-system-trigger"));
      });

      expect(mockUniwindSetTheme).toHaveBeenCalledWith("system");
      await waitFor(() => expect(mockedSaveThemePreference).toHaveBeenCalledWith("system"));
    });
  });
});
