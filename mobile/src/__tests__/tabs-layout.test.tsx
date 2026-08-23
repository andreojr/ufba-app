import { render } from "@testing-library/react-native";

import { useSigaaLink } from "@/lib/sigaa-link-context";

import TabsLayout from "@/app/(tabs)/_layout";

jest.mock("@/lib/sigaa-link-context");

const mockReplace = jest.fn();
jest.mock("expo-router", () => {
  const { View } = jest.requireActual("react-native");
  const Stack = Object.assign(({ children }: any) => <View>{children}</View>, {
    Screen: () => null,
  });
  return { Stack, useRouter: () => ({ replace: mockReplace }) };
});

jest.mock("heroui-native", () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
}));

const mockedUseSigaaLink = jest.mocked(useSigaaLink);

const LINK_ACTIONS = { link: jest.fn(), unlink: jest.fn() };

describe("TabsLayout onboarding redirect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends a brand-new user to link their account", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "unlinked",
      jaVinculou: false,
      ...LINK_ACTIONS,
    });

    await render(<TabsLayout />);

    expect(mockReplace).toHaveBeenCalledWith("/link-account");
  });

  it("leaves a returning user alone after they unlink, so they keep reading their stored data", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "unlinked",
      jaVinculou: true,
      ...LINK_ACTIONS,
    });

    await render(<TabsLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("never redirects while the account is linked", async () => {
    mockedUseSigaaLink.mockReturnValue({
      status: "linked",
      syncMode: "device",
      senhaDesatualizada: false,
      jaVinculou: true,
      ...LINK_ACTIONS,
    });

    await render(<TabsLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
