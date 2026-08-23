import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import type { JSX } from "react";

import { getAppVersion } from "@/lib/api";
import { getUltimaChecagem, getVersaoDispensada, marcarChecagem } from "@/lib/app-update-storage";
import { useAppUpdate } from "@/lib/use-app-update";

jest.mock("@/lib/api", () => ({ getAppVersion: jest.fn() }));
jest.mock("@/lib/app-update-storage", () => ({
  INTERVALO_CHECAGEM_MS: 3_600_000,
  getVersaoDispensada: jest.fn(),
  dispensarVersao: jest.fn().mockResolvedValue(undefined),
  getUltimaChecagem: jest.fn(),
  marcarChecagem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-constants", () => ({ expoConfig: { version: "1.0.0" } }));

const RELEASE = {
  latestVersion: "1.1.0",
  versionCode: 3,
  downloadUrl: "https://example.com/gradline-1.1.0.apk",
  releaseNotes: "Optativas.",
  publishedAt: "2026-09-01T12:00:00Z",
};

function Sonda(): JSX.Element {
  const { temAtualizacao, versaoInstalada } = useAppUpdate();
  return (
    <>
      <Text testID="instalada">{versaoInstalada}</Text>
      <Text testID="tem">{temAtualizacao ? "sim" : "nao"}</Text>
    </>
  );
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getVersaoDispensada).mockResolvedValue(null);
    jest.mocked(getUltimaChecagem).mockResolvedValue(null);
    jest.mocked(getAppVersion).mockResolvedValue(RELEASE);
  });

  it("reports the installed version off the Expo config", async () => {
    render(<Sonda />);

    // RTL v14 renders asynchronously — `screen` is only populated once the
    // first await lands, so the assertion has to go through waitFor.
    await waitFor(() => expect(screen.getByTestId("instalada")).toHaveTextContent("1.0.0"));
  });

  it("flags an update when the published version is ahead", async () => {
    render(<Sonda />);

    await waitFor(() => expect(screen.getByTestId("tem")).toHaveTextContent("sim"));
    expect(marcarChecagem).toHaveBeenCalled();
  });

  it("stays quiet when the user already dismissed that exact version", async () => {
    jest.mocked(getVersaoDispensada).mockResolvedValue("1.1.0");

    render(<Sonda />);

    await waitFor(() => expect(getAppVersion).toHaveBeenCalled());
    expect(screen.getByTestId("tem")).toHaveTextContent("nao");
  });

  it("stays quiet — and never throws — when the backend is unreachable", async () => {
    jest.mocked(getAppVersion).mockRejectedValue(new Error("offline"));

    render(<Sonda />);

    await waitFor(() => expect(getAppVersion).toHaveBeenCalled());
    expect(screen.getByTestId("tem")).toHaveTextContent("nao");
  });

  it("skips the request when the last check was inside the window", async () => {
    jest.mocked(getUltimaChecagem).mockResolvedValue(Date.now() - 60_000);

    render(<Sonda />);

    await waitFor(() => expect(getUltimaChecagem).toHaveBeenCalled());
    expect(getAppVersion).not.toHaveBeenCalled();
  });
});
