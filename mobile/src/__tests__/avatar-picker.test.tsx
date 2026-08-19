import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { useAuth } from "@/lib/auth-context";
import { AVATAR_LOOKAHEAD, AVATAR_MAX_HISTORY } from "@/lib/avatar-seed-history";

import AvatarPickerScreen from "@/app/avatar-picker";

jest.mock("@/lib/auth-context");

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("react-native-svg", () => {
  const { Text } = jest.requireActual("react-native");
  return { SvgXml: ({ xml, testID }: any) => <Text testID={testID} xml={xml} /> };
});

const mockToastShow = jest.fn();

jest.mock("heroui-native", () => {
  const { Text, TouchableOpacity } = jest.requireActual("react-native");

  return {
    useToast: () => ({ toast: { show: mockToastShow } }),
    useThemeColor: (tokens: string[]) => tokens.map(() => "#000000"),
    Button: Object.assign(
      ({ children, onPress, isDisabled, testID }: any) => (
        <TouchableOpacity onPress={onPress} disabled={isDisabled} testID={testID} accessibilityRole="button">
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </TouchableOpacity>
      ),
      { Label: ({ children }: any) => <Text>{children}</Text> },
    ),
    Spinner: ({ testID }: any) => <Text testID={testID}>loading</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
  };
});

const mockedUseAuth = jest.mocked(useAuth);

describe("AvatarPickerScreen", () => {
  const updateAvatarUrl = jest.fn();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn((url: string) => Promise.resolve({ ok: true, text: async () => url }));
    global.fetch = fetchMock as unknown as typeof fetch;
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "a@ufba.br", name: "Ana Carvalho", avatarUrl: null },
      signIn: jest.fn(),
      signOut: jest.fn(),
      updateAvatarUrl,
    } as any);
  });

  it("prefetches a full lookahead window of avatars up front, in parallel", async () => {
    await render(<AvatarPickerScreen />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(AVATAR_LOOKAHEAD));
  });

  it("shows an Open Peeps DiceBear avatar preview using the bold pop background preset once preloaded", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);

    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());
    const preview = getByTestId("avatar-preview");
    expect(preview.props.xml).toContain("https://api.dicebear.com/9.x/open-peeps/svg?seed=");
    expect(preview.props.xml).toContain("backgroundColor=ff8fab,ffb703,4cc9a7,4d96ff,b57bff");
  });

  it("goes back when the close icon is pressed", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-close"));
    });

    expect(mockBack).toHaveBeenCalled();
  });

  it("disables the previous-avatar arrow initially", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);

    expect(getByTestId("avatar-picker-prev").props.accessibilityState?.disabled).toBe(true);
  });

  it("moves to a new, already-preloaded avatar and enables the previous arrow when the next arrow is pressed", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());

    const initialXml = getByTestId("avatar-preview").props.xml;
    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });

    expect(getByTestId("avatar-preview").props.xml).not.toBe(initialXml);
    expect(getByTestId("avatar-picker-prev").props.accessibilityState?.disabled).toBe(false);
  });

  it("disables the next arrow while the upcoming avatar hasn't finished preloading yet", async () => {
    const pendingResolvers: (() => void)[] = [];
    let callIndex = 0;
    fetchMock.mockImplementation((url: string) => {
      const index = callIndex++;
      if (index < AVATAR_LOOKAHEAD) {
        return Promise.resolve({ ok: true, text: async () => url });
      }
      // Every fetch beyond the initial lookahead batch stays pending until the
      // test explicitly resolves it, so we can observe the "still loading" state.
      return new Promise((resolve) => {
        pendingResolvers.push(() => resolve({ ok: true, text: async () => url }));
      });
    });

    const { getByTestId } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());

    // Index 0 -> 1: target (seed already in the initial preloaded batch) is ready.
    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });
    expect(getByTestId("avatar-picker-next").props.accessibilityState?.disabled).toBe(false);

    // Index 1 -> 2: this move also replenishes the lookahead with a brand-new seed
    // whose fetch we're holding pending — so the *next* press's target isn't ready.
    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });
    expect(getByTestId("avatar-picker-next").props.accessibilityState?.disabled).toBe(true);

    // Resolve the fetch for the seed that's actually gating the button (the first
    // one queued beyond the initial batch) — not whichever fetch fired most recently.
    await act(async () => {
      pendingResolvers[0]?.();
    });

    expect(getByTestId("avatar-picker-next").props.accessibilityState?.disabled).toBe(false);
  });

  it("prefetches one more avatar to replenish the lookahead window after moving next", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());
    fetchMock.mockClear();

    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("going back with the previous arrow restores the same avatar without re-fetching it, even after moving forward again", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());

    const first = getByTestId("avatar-preview").props.xml;
    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });
    const second = getByTestId("avatar-preview").props.xml;

    fetchMock.mockClear();
    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-prev"));
    });
    expect(getByTestId("avatar-preview").props.xml).toBe(first);

    await act(async () => {
      fireEvent.press(getByTestId("avatar-picker-next"));
    });
    expect(getByTestId("avatar-preview").props.xml).toBe(second);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps history so the previous arrow can go back at most AVATAR_MAX_HISTORY - AVATAR_LOOKAHEAD steps", async () => {
    const { getByTestId } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());

    for (let i = 0; i < AVATAR_MAX_HISTORY * 2; i++) {
      await act(async () => {
        fireEvent.press(getByTestId("avatar-picker-next"));
      });
    }

    const maxStepsBack = AVATAR_MAX_HISTORY - AVATAR_LOOKAHEAD;
    for (let i = 0; i < maxStepsBack; i++) {
      await act(async () => {
        fireEvent.press(getByTestId("avatar-picker-prev"));
      });
    }

    expect(getByTestId("avatar-picker-prev").props.accessibilityState?.disabled).toBe(true);
  });

  it("saves the current avatar and goes back when 'Salvar' is pressed", async () => {
    updateAvatarUrl.mockResolvedValue(undefined);
    const { getByTestId, getByText } = await render(<AvatarPickerScreen />);
    await waitFor(() => expect(getByTestId("avatar-preview")).toBeTruthy());

    const avatarUrl = getByTestId("avatar-preview").props.xml;
    await act(async () => {
      fireEvent.press(getByText("Salvar"));
    });

    await waitFor(() => expect(updateAvatarUrl).toHaveBeenCalledWith(avatarUrl));
    expect(mockBack).toHaveBeenCalled();
  });
});
