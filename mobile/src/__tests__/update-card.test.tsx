import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { UpdateCard } from "@/components/UpdateCard";
import { baixarEInstalar, InstalacaoIndisponivelError } from "@/lib/app-update-install";
import { useAppUpdate } from "@/lib/use-app-update";

jest.mock("@/lib/use-app-update");
jest.mock("@/lib/app-update-install", () => ({
  baixarEInstalar: jest.fn().mockResolvedValue(undefined),
  InstalacaoIndisponivelError: class extends Error {},
}));

jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress, isDisabled, testID }: any) => (
      <TouchableOpacity
        testID={testID}
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
      >
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <View testID="spinner" />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#000000",
  };
});

const RELEASE = {
  latestVersion: "1.1.0",
  versionCode: 3,
  downloadUrl: "https://example.com/gradline-1.1.0.apk",
  releaseNotes: "Optativas na Trajetória.",
  publishedAt: "2026-09-01T12:00:00Z",
};

function comAtualizacao(overrides = {}) {
  jest.mocked(useAppUpdate).mockReturnValue({
    versaoInstalada: "1.0.0",
    release: RELEASE,
    temAtualizacao: true,
    dispensar: jest.fn(),
    ...overrides,
  });
}

describe("UpdateCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when there is no update", async () => {
    jest.mocked(useAppUpdate).mockReturnValue({
      versaoInstalada: "1.0.0",
      release: null,
      temAtualizacao: false,
      dispensar: jest.fn(),
    });

    await render(<UpdateCard />);

    expect(screen.queryByTestId("update-card")).toBeNull();
  });

  it("announces the new version and its notes", async () => {
    comAtualizacao();

    await render(<UpdateCard />);

    expect(screen.getByTestId("update-card")).toBeTruthy();
    expect(screen.getByText(/1\.1\.0/)).toBeTruthy();
    expect(screen.getByText("Optativas na Trajetória.")).toBeTruthy();
  });

  it("downloads and installs when the user accepts", async () => {
    comAtualizacao();

    await render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    await waitFor(() =>
      expect(baixarEInstalar).toHaveBeenCalledWith(
        RELEASE.downloadUrl,
        "1.1.0",
        expect.any(Function),
      ),
    );
  });

  it("renders the measured progress as a filled bar", async () => {
    comAtualizacao();
    jest.mocked(baixarEInstalar).mockImplementation(async (_url, _v, onProgresso) => {
      onProgresso(0.4);
    });

    await render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    const barra = await screen.findByTestId("update-progress-fill");
    expect(barra.props.style).toEqual(expect.objectContaining({ width: "40%" }));
  });

  it("falls back to an indeterminate state when the size is unknown", async () => {
    comAtualizacao();
    jest.mocked(baixarEInstalar).mockImplementation(async (_url, _v, onProgresso) => {
      onProgresso(null);
    });

    await render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    expect(await screen.findByTestId("update-progress-indeterminate")).toBeTruthy();
    expect(screen.queryByTestId("update-progress-fill")).toBeNull();
  });

  it("opens the site when the system installer cannot be reached", async () => {
    comAtualizacao();
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(baixarEInstalar).mockRejectedValue(new InstalacaoIndisponivelError());

    await render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(RELEASE.downloadUrl));
  });

  it("dismisses without installing", async () => {
    const dispensar = jest.fn();
    comAtualizacao({ dispensar });

    await render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-dismiss"));

    expect(dispensar).toHaveBeenCalled();
    expect(baixarEInstalar).not.toHaveBeenCalled();
  });
});
