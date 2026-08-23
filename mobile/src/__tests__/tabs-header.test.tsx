import { act, fireEvent, render } from "@testing-library/react-native";

import { useAuth } from "@/lib/auth-context";

import { TabsHeader } from "@/components/TabsHeader";

jest.mock("@/lib/auth-context");

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("heroui-native", () => {
  const { Text, View, Pressable } = jest.requireActual("react-native");
  const { createContext, useContext, useState } = jest.requireActual("react");

  // Stand-in for the real compound Popover: the trigger genuinely toggles open
  // state and the content only mounts once open, so a test that presses the
  // trigger is exercising this screen's wiring rather than a always-rendered stub.
  // No type argument: `createContext` comes from requireActual and is untyped,
  // and annotating it trips TS2347 (see the same pattern in ajustes.test.tsx).
  const PopoverContext = createContext({ open: false, setOpen: (_: boolean) => {} });
  const Popover = Object.assign(
    ({ children }: any) => {
      const [open, setOpen] = useState(false);
      return <PopoverContext.Provider value={{ open, setOpen }}>{children}</PopoverContext.Provider>;
    },
    {
      Trigger: ({ children, ...props }: any) => {
        const { open, setOpen } = useContext(PopoverContext);
        return (
          <Pressable {...props} onPress={() => setOpen(!open)}>
            {children}
          </Pressable>
        );
      },
      Portal: ({ children }: any) => {
        const { open } = useContext(PopoverContext);
        return open ? <View>{children}</View> : null;
      },
      Overlay: () => null,
      Content: ({ children }: any) => <View>{children}</View>,
      Arrow: () => null,
      Close: () => null,
      Title: ({ children }: any) => <Text>{children}</Text>,
      Description: ({ children }: any) => <Text>{children}</Text>,
    },
  );

  return {
    Avatar: Object.assign(({ children }: any) => <View>{children}</View>, {
      Fallback: ({ children }: any) => <Text>{children}</Text>,
    }),
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

// Only SvgUri is stubbed (it does a real network fetch); the rest of the module
// stays real so UfbaCrest still renders (unused here, but AppBar-parity mocks match).
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

/** Same Wednesday used across the suite, at whatever time of day a test needs. */
function pinTo(hour: number, minute: number): void {
  jest.useFakeTimers({ now: new Date(2026, 7, 19, hour, minute, 0), advanceTimers: true });
}

describe("TabsHeader", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
    } as any);
    mockPush.mockClear();
  });

  it("offers the carga-horária legend behind an info button on the trajetória page", async () => {
    pinTo(9, 0);

    const { getByTestId, getByText, queryByText } = await render(<TabsHeader activePage={1} />);

    // Closed to start with — the legend is not spilling into the header.
    expect(queryByText("muito densa")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("legenda-densidade-trigger"));
    });

    for (const palavra of ["leve", "média", "pesada", "muito densa"]) {
      expect(getByText(palavra)).toBeTruthy();
    }
  });

  it("keeps the legend button off the pages the scale says nothing about", async () => {
    pinTo(9, 0);

    const { queryByTestId } = await render(<TabsHeader activePage={0} />);

    expect(queryByTestId("legenda-densidade-trigger")).toBeNull();
  });

  it("greets the student by name on the Início page instead of a generic title", async () => {
    pinTo(9, 0);

    const { getByText } = await render(<TabsHeader activePage={0} />);

    expect(getByText(/^(Bom dia|Boa tarde|Boa noite), Ana!$/)).toBeTruthy();
  });

  it("renders the student's name as its own element so it can carry the accent tint", async () => {
    pinTo(9, 0);

    const { getByTestId } = await render(<TabsHeader activePage={0} />);

    const name = getByTestId("app-bar-greeting-name");
    expect(name).toHaveTextContent("Ana");
    expect(name.props.className).toContain("text-accent");
  });

  it("shows the static title for a non-Início page instead of the greeting", async () => {
    pinTo(9, 0);

    const { getByText, queryByText } = await render(<TabsHeader activePage={2} />);

    expect(getByText("Insights")).toBeTruthy();
    expect(queryByText(/^(Bom dia|Boa tarde|Boa noite), Ana!$/)).toBeNull();
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

    const { getByTestId } = await render(<TabsHeader activePage={0} />);

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

    const { getByText, queryByTestId } = await render(<TabsHeader activePage={0} />);

    expect(queryByTestId("app-bar-avatar-image")).toBeNull();
    expect(getByText("BS")).toBeTruthy();
  });

  it("opens Ajustes — not the avatar picker — when the header profile group is pressed", async () => {
    const { getByTestId } = await render(<TabsHeader activePage={0} />);

    await act(async () => {
      fireEvent.press(getByTestId("app-bar-profile"));
    });

    expect(mockPush).toHaveBeenCalledWith("/ajustes");
    expect(mockPush).not.toHaveBeenCalledWith("/avatar-picker");
  });

  it("shows a settings cog next to the header avatar", async () => {
    const { getByTestId } = await render(<TabsHeader activePage={0} />);

    expect(getByTestId("app-bar-settings-icon")).toBeTruthy();
  });
});
