import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";

import { MOODLE_RETURN_SCHEME, parseReturnedToken, startMoodleLogin, verifyPassport } from "./moodle-auth";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { MD5: "MD5" },
  digestStringAsync: jest.fn(),
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
}));

const mockCrypto = Crypto as jest.Mocked<typeof Crypto>;
const mockBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;

// Base64 helper for tests (Node has Buffer).
const b64 = (s: string): string => Buffer.from(s, "utf-8").toString("base64");

describe("parseReturnedToken", () => {
  it("splits signature, token and private token", () => {
    const parsed = parseReturnedToken(b64("sig:::mytoken:::mypriv"));
    expect(parsed).toEqual({ signature: "sig", wstoken: "mytoken", privatetoken: "mypriv" });
  });

  it("handles a token without a private token", () => {
    const parsed = parseReturnedToken(b64("sig:::mytoken"));
    expect(parsed).toEqual({ signature: "sig", wstoken: "mytoken", privatetoken: undefined });
  });

  it("throws when the decoded value has no token part", () => {
    expect(() => parseReturnedToken(b64("justsignature"))).toThrow();
  });
});

describe("verifyPassport", () => {
  it("returns true when the signature matches md5(siteUrl + passport)", async () => {
    mockCrypto.digestStringAsync.mockResolvedValueOnce("expectedhash");
    await expect(verifyPassport("expectedhash", "https://ava.ufba.br", "0.42")).resolves.toBe(true);
    expect(mockCrypto.digestStringAsync).toHaveBeenCalledWith("MD5", "https://ava.ufba.br0.42");
  });

  it("returns false when the signature does not match", async () => {
    mockCrypto.digestStringAsync.mockResolvedValueOnce("somethingelse");
    await expect(verifyPassport("expectedhash", "https://ava.ufba.br", "0.42")).resolves.toBe(false);
  });
});

describe("startMoodleLogin", () => {
  const resolveUserId = jest.fn<Promise<number>, [string, string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    resolveUserId.mockResolvedValue(7);
    // md5 always "matches" so verifyPassport passes in the success path.
    mockCrypto.digestStringAsync.mockImplementation(async () => "sig");
  });

  it("returns cancelled when the user closes the browser", async () => {
    mockBrowser.openAuthSessionAsync.mockResolvedValueOnce({ type: "cancel" } as never);
    await expect(startMoodleLogin(resolveUserId)).resolves.toEqual({ status: "cancelled" });
  });

  it("returns success with a session when the token is valid", async () => {
    const token = Buffer.from("sig:::wstok:::priv", "utf-8").toString("base64");
    mockBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: "success",
      url: `${MOODLE_RETURN_SCHEME}://token=${token}`,
    } as never);

    const result = await startMoodleLogin(resolveUserId);
    expect(result).toEqual({
      status: "success",
      session: {
        wstoken: "wstok",
        privatetoken: "priv",
        siteUrl: "https://ava.ufba.br",
        userId: 7,
      },
    });
  });

  it("fails when the passport signature does not match", async () => {
    mockCrypto.digestStringAsync.mockResolvedValue("different");
    const token = Buffer.from("sig:::wstok", "utf-8").toString("base64");
    mockBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: "success",
      url: `${MOODLE_RETURN_SCHEME}://token=${token}`,
    } as never);

    const result = await startMoodleLogin(resolveUserId);
    expect(result.status).toBe("failed");
  });
});
