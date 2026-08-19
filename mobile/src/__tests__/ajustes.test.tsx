import { render } from "@testing-library/react-native";

import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";

import AjustesTab from "@/app/(tabs)/ajustes";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/mock-app-state", () => ({
  useMockAppState: () => ({ studentName: "Ana Carvalho" }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseSigaaLink = jest.mocked(useSigaaLink);

describe("AjustesTab", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ status: "signedIn", signIn: jest.fn(), signOut: jest.fn() } as any);
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
});
