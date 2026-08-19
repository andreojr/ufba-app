import { act, fireEvent, render } from "@testing-library/react-native";

import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";

import AjustesTab from "@/app/(tabs)/ajustes";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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
      Item: ({ children, onPress }: any) => <TouchableOpacity onPress={onPress}>{children}</TouchableOpacity>,
      ItemPrefix: ({ children }: any) => <View>{children}</View>,
      ItemSuffix: ({ children }: any) => <View>{children}</View>,
      ItemContent: ({ children }: any) => <View>{children}</View>,
      ItemTitle: ({ children }: any) => <Text>{children}</Text>,
      ItemDescription: ({ children }: any) => <Text>{children}</Text>,
    }),
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

jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  return { SvgUri: ({ uri, testID }: any) => <Text testID={testID} uri={uri} /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);

const mockRefreshUser = jest.fn();

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
});
