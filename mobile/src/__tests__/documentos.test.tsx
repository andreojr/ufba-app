import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import { ApiError, postSigaaAtestado, postSigaaHistorico } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { htmlToPdfBytes } from "@/lib/html-to-pdf";
import {
  deleteSigaaDocument,
  getSavedSigaaDocument,
  openSavedSigaaDocument,
  saveSigaaDocument,
} from "@/lib/sigaa-documents";
import { getSigaaCredentials } from "@/lib/sigaa-storage";

import DocumentosScreen from "@/app/documentos";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack, push: jest.fn() }) }));

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/html-to-pdf", () => ({ htmlToPdfBytes: jest.fn() }));
jest.mock("@/lib/sigaa-documents", () => ({
  ...jest.requireActual("@/lib/sigaa-documents"),
  getSavedSigaaDocument: jest.fn(),
  saveSigaaDocument: jest.fn(),
  openSavedSigaaDocument: jest.fn(),
  deleteSigaaDocument: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  postSigaaHistorico: jest.fn(),
  postSigaaAtestado: jest.fn(),
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
    Chip: ({ children }: any) => <Text>{children}</Text>,
    ListGroup: Object.assign(({ children }: any) => <View>{children}</View>, {
      Item: ({ children, onPress }: any) => (
        <TouchableOpacity onPress={onPress} accessibilityRole="button">
          {children}
        </TouchableOpacity>
      ),
      ItemPrefix: ({ children }: any) => <View>{children}</View>,
      ItemContent: ({ children }: any) => <View>{children}</View>,
      ItemTitle: ({ children }: any) => <Text>{children}</Text>,
      ItemDescription: ({ children }: any) => <Text>{children}</Text>,
      ItemSuffix: ({ children }: any) => <View>{children}</View>,
    }),
    Spinner: () => <Text>Carregando spinner</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetSigaaCredentials = jest.mocked(getSigaaCredentials);
const mockedPostSigaaHistorico = jest.mocked(postSigaaHistorico);
const mockedPostSigaaAtestado = jest.mocked(postSigaaAtestado);
const mockedHtmlToPdfBytes = jest.mocked(htmlToPdfBytes);
const mockedGetSavedSigaaDocument = jest.mocked(getSavedSigaaDocument);
const mockedSaveSigaaDocument = jest.mocked(saveSigaaDocument);
const mockedOpenSavedSigaaDocument = jest.mocked(openSavedSigaaDocument);
const mockedDeleteSigaaDocument = jest.mocked(deleteSigaaDocument);

describe("DocumentosScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { id: "1", email: "a@ufba.br", name: "Ana", avatarUrl: null },
    } as any);
    mockedGetSavedSigaaDocument.mockReturnValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("walks the busy bar through the calibrated SIGAA stage labels while the download is in flight", async () => {
    jest.useFakeTimers();
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedPostSigaaHistorico.mockReturnValue(new Promise(() => {})); // stays in flight

    const { getAllByText, getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Baixar")[1]); // histórico is the second card
    });
    expect(getByText("Entrando no SIGAA…")).toBeTruthy();

    // act must be async here: with fake timers on, React's own render commit
    // sits on the (mocked) scheduler queue, and only the async form flushes it.
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    expect(getByText("Abrindo o portal do discente…")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(getByText("Gerando o PDF do histórico…")).toBeTruthy();

    // Drain before switching back to real timers — React schedules its own
    // work on the (fake) timer queue, and discarding it corrupts rendering
    // for every test that runs after this one.
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("goes back to Perfil when the close button is pressed", async () => {
    const { getByTestId } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("app-bar-close"));
    });

    expect(mockBack).toHaveBeenCalled();
  });

  it("shows a 'Baixar' button for a document never downloaded", async () => {
    const { getAllByText } = await render(<DocumentosScreen />);

    expect(getAllByText("Baixar").length).toBeGreaterThan(0);
  });

  it("downloads the histórico, saves it, and shows the saved state", async () => {
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockedPostSigaaHistorico.mockResolvedValue(pdfBytes);
    mockedSaveSigaaDocument.mockReturnValue({
      uri: "file:///document/historico-escolar.pdf",
      size: 4,
      savedAt: new Date("2026-08-18T12:00:00Z"),
    });

    const { getAllByText, getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Baixar")[1]); // histórico is the second card
    });

    await waitFor(() => expect(mockedSaveSigaaDocument).toHaveBeenCalledWith("historico", pdfBytes));
    expect(mockedPostSigaaHistorico).toHaveBeenCalledWith("token", { login: "123", senha: "segredo" });
    expect(getByText("Gerar de novo")).toBeTruthy();
  });

  it("downloads the atestado (backend HTML rendered to PDF on device), saves it, and shows the saved state", async () => {
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedPostSigaaAtestado.mockResolvedValue("<html><body>MATRICULADO</body></html>");
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    mockedHtmlToPdfBytes.mockResolvedValue(pdfBytes);
    mockedSaveSigaaDocument.mockReturnValue({
      uri: "file:///document/atestado-matricula.pdf",
      size: 4,
      savedAt: new Date("2026-08-18T12:00:00Z"),
    });

    const { getAllByText, getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Baixar")[0]); // atestado is the first card
    });

    await waitFor(() => expect(mockedSaveSigaaDocument).toHaveBeenCalledWith("atestado", pdfBytes));
    expect(mockedPostSigaaAtestado).toHaveBeenCalledWith("token", { login: "123", senha: "segredo" });
    expect(mockedHtmlToPdfBytes).toHaveBeenCalledWith("<html><body>MATRICULADO</body></html>");
    expect(getByText("Gerar de novo")).toBeTruthy();
  });

  it("shows an error and no saved state when the atestado download fails", async () => {
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "wrong", syncMode: "device" });
    mockedPostSigaaAtestado.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { getAllByText, getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Baixar")[0]);
    });

    await waitFor(() => expect(getByText("Credenciais inválidas")).toBeTruthy());
    expect(mockedSaveSigaaDocument).not.toHaveBeenCalled();
  });

  it("shows an error and no saved state when the histórico download fails", async () => {
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "wrong", syncMode: "device" });
    mockedPostSigaaHistorico.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { getAllByText, getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getAllByText("Baixar")[1]);
    });

    await waitFor(() => expect(getByText("Credenciais inválidas")).toBeTruthy());
    expect(mockedSaveSigaaDocument).not.toHaveBeenCalled();
  });

  it("renders an already-saved document as done, with a 'Gerar de novo' action", async () => {
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );

    const { getByText, getAllByText } = await render(<DocumentosScreen />);

    expect(getByText("Gerar de novo")).toBeTruthy();
    expect(getByText("No aparelho")).toBeTruthy();
    expect(getAllByText(/02\/05\/2026/).length).toBeGreaterThan(0);
  });

  it("keeps the on-device copy listed while a 'Gerar de novo' download is in flight", async () => {
    jest.useFakeTimers();
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedPostSigaaHistorico.mockReturnValue(new Promise(() => {})); // stays in flight

    const { getByText, getAllByText, queryByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByText("Gerar de novo"));
    });

    // The whole point of "No aparelho" is not having to wait for a download:
    // the previous copy stays listed (and openable) until a new one lands.
    expect(getByText("No aparelho")).toBeTruthy();
    expect(getAllByText(/02\/05\/2026/).length).toBeGreaterThan(0);
    expect(queryByText("Entrando no SIGAA…")).toBeTruthy();

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("keeps the on-device copy listed when a 'Gerar de novo' download fails", async () => {
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });
    mockedPostSigaaHistorico.mockRejectedValue(new ApiError("Credenciais inválidas", 401));

    const { getByText, getAllByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByText("Gerar de novo"));
    });

    await waitFor(() => expect(getByText("Credenciais inválidas")).toBeTruthy());
    expect(getByText("No aparelho")).toBeTruthy();
    expect(getAllByText(/02\/05\/2026/).length).toBeGreaterThan(0);
  });

  it("swaps the listed copy for the new one only once the download completes", async () => {
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );
    mockedGetSigaaCredentials.mockResolvedValue({ login: "123", senha: "segredo", syncMode: "device" });

    let resolveDownload: (bytes: Uint8Array) => void = () => {};
    mockedPostSigaaHistorico.mockReturnValue(
      new Promise<Uint8Array>((resolve) => {
        resolveDownload = resolve;
      }),
    );
    mockedSaveSigaaDocument.mockReturnValue({
      uri: "file:///document/historico-escolar.pdf",
      size: 8192,
      savedAt: new Date("2026-08-19T12:00:00Z"),
    });

    const { getByText, getAllByText, queryAllByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByText("Gerar de novo"));
    });
    expect(getAllByText(/02\/05\/2026/).length).toBeGreaterThan(0);

    await act(async () => {
      resolveDownload(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    });

    await waitFor(() => expect(getAllByText(/19\/08\/2026/).length).toBeGreaterThan(0));
    expect(queryAllByText(/02\/05\/2026/)).toHaveLength(0);
  });

  it("opens the saved document when its row in 'No aparelho' is tapped", async () => {
    const savedHistorico = {
      uri: "file:///document/historico-escolar.pdf",
      size: 4096,
      savedAt: new Date("2026-05-02T12:00:00Z"),
    };
    mockedGetSavedSigaaDocument.mockImplementation((key) => (key === "historico" ? savedHistorico : null));

    const { getAllByText } = await render(<DocumentosScreen />);

    await act(async () => {
      // The card header repeats the same title; the row inside "No aparelho" is the last match.
      const matches = getAllByText("Histórico escolar");
      fireEvent.press(matches[matches.length - 1]);
    });

    expect(mockedOpenSavedSigaaDocument).toHaveBeenCalledWith(savedHistorico);
  });

  it("asks for confirmation before deleting a saved document, and does nothing if cancelled", async () => {
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const { getByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByText("Excluir"));
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockedDeleteSigaaDocument).not.toHaveBeenCalled();
    expect(getByText("Gerar de novo")).toBeTruthy();
  });

  it("deletes the document and returns to the idle state once the user confirms", async () => {
    mockedGetSavedSigaaDocument.mockImplementation((key) =>
      key === "historico"
        ? { uri: "file:///document/historico-escolar.pdf", size: 4096, savedAt: new Date("2026-05-02T12:00:00Z") }
        : null,
    );
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const confirm = buttons?.find((button) => button.style === "destructive");
      confirm?.onPress?.();
    });

    const { getByText, queryByText } = await render(<DocumentosScreen />);

    await act(async () => {
      fireEvent.press(getByText("Excluir"));
    });

    expect(mockedDeleteSigaaDocument).toHaveBeenCalledWith("historico");
    expect(queryByText("Excluir")).toBeNull();
    expect(queryByText("No aparelho")).toBeNull();
  });
});
