import * as Crypto from "expo-crypto";

export type ParsedMoodleToken = {
  signature: string;
  wstoken: string;
  privatetoken?: string;
};

function decodeBase64(value: string): string {
  // atob exists in RN's Hermes runtime; Buffer covers the Node test env.
  if (typeof atob === "function") {
    return atob(value);
  }
  return Buffer.from(value, "base64").toString("utf-8");
}

export function parseReturnedToken(base64: string): ParsedMoodleToken {
  const decoded = decodeBase64(base64);
  const parts = decoded.split(":::");
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Resposta de token do Moodle em formato inesperado");
  }
  return {
    signature: parts[0],
    wstoken: parts[1],
    privatetoken: parts[2] || undefined,
  };
}

export async function verifyPassport(
  signature: string,
  siteUrl: string,
  passport: string,
): Promise<boolean> {
  const expected = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.MD5,
    siteUrl + passport,
  );
  return signature === expected;
}
