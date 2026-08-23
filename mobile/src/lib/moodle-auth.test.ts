import * as Crypto from "expo-crypto";

import {
  buildMoodleLaunchUrl,
  completeMoodleLogin,
  isMoodleReturnUrl,
  MOODLE_RETURN_SCHEME,
  parseReturnedToken,
  verifyPassport,
} from "./moodle-auth";

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

describe("buildMoodleLaunchUrl", () => {
  it("builds the mobile-app launch URL with the passport and our return scheme", () => {
    const url = buildMoodleLaunchUrl("0.42");
    expect(url).toContain("https://ava.ufba.br/admin/tool/mobile/launch.php");
    expect(url).toContain("service=moodle_mobile_app");
    expect(url).toContain("passport=0.42");
    expect(url).toContain(`urlscheme=${MOODLE_RETURN_SCHEME}`);
  });
});

describe("isMoodleReturnUrl", () => {
  it("matches the app-scheme token redirect", () => {
    expect(isMoodleReturnUrl(`${MOODLE_RETURN_SCHEME}://token=abc`)).toBe(true);
  });

  it("does not match the https launch/SSO pages", () => {
    expect(isMoodleReturnUrl("https://ava.ufba.br/admin/tool/mobile/launch.php")).toBe(false);
    expect(isMoodleReturnUrl("https://cafe.ufba.br/idp/profile/SAML2/Redirect/SSO")).toBe(false);
  });
});

describe("completeMoodleLogin", () => {
  const resolveUserId = jest.fn<Promise<number>, [string, string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    resolveUserId.mockResolvedValue(7);
    // md5 always "matches" so verifyPassport passes in the success path.
    mockCrypto.digestStringAsync.mockImplementation(async () => "sig");
  });

  it("returns success with a session when the redirect token is valid", async () => {
    const token = Buffer.from("sig:::wstok:::priv", "utf-8").toString("base64");
    const result = await completeMoodleLogin(
      `${MOODLE_RETURN_SCHEME}://token=${token}`,
      "0.42",
      resolveUserId,
    );
    expect(result).toEqual({
      status: "success",
      session: {
        wstoken: "wstok",
        privatetoken: "priv",
        siteUrl: "https://ava.ufba.br",
        userId: 7,
      },
    });
    expect(resolveUserId).toHaveBeenCalledWith("wstok", "https://ava.ufba.br");
  });

  it("fails when the redirect has no token param", async () => {
    const result = await completeMoodleLogin(`${MOODLE_RETURN_SCHEME}://cancelled`, "0.42", resolveUserId);
    expect(result.status).toBe("failed");
    expect(resolveUserId).not.toHaveBeenCalled();
  });

  it("fails when the passport signature does not match", async () => {
    mockCrypto.digestStringAsync.mockResolvedValue("different");
    const token = Buffer.from("sig:::wstok", "utf-8").toString("base64");
    const result = await completeMoodleLogin(
      `${MOODLE_RETURN_SCHEME}://token=${token}`,
      "0.42",
      resolveUserId,
    );
    expect(result.status).toBe("failed");
    expect(resolveUserId).not.toHaveBeenCalled();
  });
});
