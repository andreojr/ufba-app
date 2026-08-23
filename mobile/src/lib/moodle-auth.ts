import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";

import type { MoodleSession } from "./moodle-storage";

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

export const MOODLE_SITE_URL = "https://ava.ufba.br";
export const MOODLE_RETURN_SCHEME = "ufba-app";

export type MoodleLoginResult =
  | { status: "success"; session: MoodleSession }
  | { status: "cancelled" }
  | { status: "failed"; reason: string };

function extractTokenParam(url: string): string | null {
  const match = url.match(/[?&#]token=([^&]+)/) ?? url.match(/token=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function startMoodleLogin(
  resolveUserId: (wstoken: string, siteUrl: string) => Promise<number>,
): Promise<MoodleLoginResult> {
  const passport = String(Math.random());
  const launchUrl =
    `${MOODLE_SITE_URL}/admin/tool/mobile/launch.php` +
    `?service=moodle_mobile_app&passport=${passport}&urlscheme=${MOODLE_RETURN_SCHEME}`;

  const result = await WebBrowser.openAuthSessionAsync(
    launchUrl,
    `${MOODLE_RETURN_SCHEME}://token`,
  );

  if (result.type !== "success" || !result.url) {
    return { status: "cancelled" };
  }

  const base64 = extractTokenParam(result.url);
  if (!base64) {
    return { status: "failed", reason: "Nenhum token no retorno do Moodle" };
  }

  let parsed;
  try {
    parsed = parseReturnedToken(base64);
  } catch (error) {
    return { status: "failed", reason: (error as Error).message };
  }

  const passportOk = await verifyPassport(parsed.signature, MOODLE_SITE_URL, passport);
  if (!passportOk) {
    return { status: "failed", reason: "Assinatura do passport não confere" };
  }

  const userId = await resolveUserId(parsed.wstoken, MOODLE_SITE_URL);
  return {
    status: "success",
    session: {
      wstoken: parsed.wstoken,
      privatetoken: parsed.privatetoken,
      siteUrl: MOODLE_SITE_URL,
      userId,
    },
  };
}
