import * as Print from "expo-print";
import { File } from "expo-file-system";

import { htmlToPdfBytes } from "./html-to-pdf";

jest.mock("expo-print", () => ({ printToFileAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: jest.fn() }));

const mockedPrintToFile = jest.mocked(Print.printToFileAsync);
const MockedFile = jest.mocked(File);

describe("htmlToPdfBytes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prints the HTML to a PDF and returns its bytes", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    mockedPrintToFile.mockResolvedValue({ uri: "file:///cache/print.pdf" } as any);
    const deleteFn = jest.fn();
    MockedFile.mockImplementation(
      () => ({ bytes: () => Promise.resolve(pdfBytes), delete: deleteFn }) as any,
    );

    const result = await htmlToPdfBytes("<html><body>MATRICULADO</body></html>");

    expect(result).toEqual(pdfBytes);
    expect(mockedPrintToFile).toHaveBeenCalledWith({
      html: "<html><body>MATRICULADO</body></html>",
    });
    expect(MockedFile).toHaveBeenCalledWith("file:///cache/print.pdf");
  });

  it("cleans up the temporary print file after reading it", async () => {
    mockedPrintToFile.mockResolvedValue({ uri: "file:///cache/print.pdf" } as any);
    const deleteFn = jest.fn();
    MockedFile.mockImplementation(
      () =>
        ({ bytes: () => Promise.resolve(new Uint8Array([1])), delete: deleteFn }) as any,
    );

    await htmlToPdfBytes("<html></html>");

    expect(deleteFn).toHaveBeenCalled();
  });

  it("still returns the bytes when cleaning up the temp file fails", async () => {
    const pdfBytes = new Uint8Array([9]);
    mockedPrintToFile.mockResolvedValue({ uri: "file:///cache/print.pdf" } as any);
    MockedFile.mockImplementation(
      () =>
        ({
          bytes: () => Promise.resolve(pdfBytes),
          delete: () => {
            throw new Error("locked");
          },
        }) as any,
    );

    await expect(htmlToPdfBytes("<html></html>")).resolves.toEqual(pdfBytes);
  });
});
