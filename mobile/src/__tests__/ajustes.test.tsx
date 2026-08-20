import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { ApiError, postSchedule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "@/lib/calendar-export";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type { PeriodoLetivo, Turma } from "@/lib/types";

import AjustesTab from "@/app/(tabs)/ajustes";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  postSchedule: jest.fn(),
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
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  return {
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
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
    useThemeColor: () => "#000000",
    useToast: () => ({ toast: { show: mockToastShow } }),
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  return { SvgUri: ({ uri, testID }: any) => <Text testID={testID} uri={uri} /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedPostSchedule = jest.mocked(postSchedule);
const mockedExportScheduleToDeviceCalendar = jest.mocked(exportScheduleToDeviceCalendar);

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
    mockedPostSchedule.mockClear();
    mockedExportScheduleToDeviceCalendar.mockClear();
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
        mockedPostSchedule.mockResolvedValue({ turmas: [turma()], periodoLetivo: PERIODO_LETIVO });
        mockedExportScheduleToDeviceCalendar.mockResolvedValue(1);
      });

      it("exports the freshly-fetched schedule to the device calendar when pressed", async () => {
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
      });

      it("shows a toast instead of exporting when the term isn't known yet", async () => {
        mockedPostSchedule.mockResolvedValue({ turmas: [turma()], periodoLetivo: null });

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
        expect(mockToastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: "danger" }));
      });

      it("shows a toast asking to enable calendar access when permission is denied", async () => {
        mockedExportScheduleToDeviceCalendar.mockRejectedValue(new CalendarPermissionDeniedError());

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() =>
          expect(mockToastShow).toHaveBeenCalledWith(
            expect.objectContaining({
              variant: "danger",
              label: expect.stringMatching(/permiss/i),
            })
          )
        );
      });

      it("shows a generic error toast when fetching the schedule fails", async () => {
        mockedPostSchedule.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

        const { getByTestId } = await render(<AjustesTab />);

        await act(async () => {
          fireEvent.press(getByTestId("export-calendar-item"));
        });

        await waitFor(() =>
          expect(mockToastShow).toHaveBeenCalledWith(
            expect.objectContaining({ variant: "danger", label: "Credenciais inválidas" })
          )
        );
        expect(mockedExportScheduleToDeviceCalendar).not.toHaveBeenCalled();
      });
    });
  });
});
