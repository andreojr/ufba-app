import * as Crypto from "expo-crypto";

import { parseReturnedToken, verifyPassport } from "./moodle-auth";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { MD5: "MD5" },
  digestStringAsync: jest.fn(),
}));

const mockCrypto = Crypto as jest.Mocked<typeof Crypto>;

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
