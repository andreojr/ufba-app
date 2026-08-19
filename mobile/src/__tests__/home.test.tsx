import { render, waitFor } from "@testing-library/react-native";

import { ApiError, postSchedule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import type { Turma } from "@/lib/types";

import HomeTab from "@/app/(tabs)/index";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  postSchedule: jest.fn(),
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
      ({ children, onPress }: any) => (
        <TouchableOpacity onPress={onPress} accessibilityRole="button">
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </TouchableOpacity>
      ),
      { Label: ({ children }: any) => <Text>{children}</Text> },
    ),
    Spinner: () => <Text>Carregando spinner</Text>,
    Popover,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    useThemeColor: () => "#000000",
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedPostSchedule = jest.mocked(postSchedule);

const ALL_WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

function turmaEveryWeekday(): Turma {
  return {
    codigo: "MATA37",
    nome: "SISTEMAS OPERACIONAIS",
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

describe("HomeTab", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@ufba.br", name: "Ana" },
    } as any);
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
    mockedPostSchedule.mockResolvedValue([turmaEveryWeekday()]);

    const { getByText, getAllByText } = await render(<HomeTab />);

    await waitFor(() => expect(getAllByText("SISTEMAS OPERACIONAIS").length).toBeGreaterThan(0));
    expect(getByText("2026.2", { exact: false })).toBeTruthy();
  });

  it("shows an error message with a retry button when the fetch fails", async () => {
    mockedUseSigaaLink.mockReturnValue({ status: "linked", syncMode: "device", link: jest.fn(), unlink: jest.fn() });
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "wrong", syncMode: "device" });
    mockedPostSchedule.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { getByText } = await render(<HomeTab />);

    await waitFor(() => expect(getByText("Credenciais inválidas")).toBeTruthy());
    expect(getByText("Tentar de novo")).toBeTruthy();
  });
});
