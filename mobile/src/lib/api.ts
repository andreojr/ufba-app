import type {
  GoogleUserInfo,
  ScheduleResponse,
  SigaaCredentials,
  SigaaWebSession,
  Session,
} from "./types";

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

// The SIGAA document flows (histórico, atestado) make ~7 sequential requests to
// the real SIGAA server server-side (login, navigate, postback, follow redirect
// / inline assets) — much slower than the other endpoints. The default timeout
// was aborting mid-scrape, and the fetch polyfill was resolving that abort as an
// empty response instead of throwing, so it looked like a successful-but-empty
// download.
const SIGAA_DOCUMENT_TIMEOUT_MS = 45_000;

interface RequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  accessToken?: string;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : undefined) ?? `Request to ${path} failed with status ${response.status}`;
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function postGoogleLogin(idToken: string): Promise<Session> {
  return request<Session>("/auth/google", { method: "POST", body: { idToken } });
}

export async function postSigaaLink(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
  rememberPassword: boolean,
): Promise<void> {
  await request<{ linked: true }>("/sigaa/link", {
    method: "POST",
    accessToken,
    body: { ...credentials, rememberPassword },
  });
}

export type SigaaLinkStatus =
  | { linked: false }
  | { linked: true; login: string; senha: string };

export async function getSigaaLink(accessToken: string): Promise<SigaaLinkStatus> {
  return request<SigaaLinkStatus>("/sigaa/link", { method: "GET", accessToken });
}

/**
 * Fetches the student's current-term turmas, plus the term's own start/end
 * dates, off their atestado de matrícula. POST (not GET) because credentials
 * travel in the body, and a spec-compliant fetch client can't send a body on a
 * GET request.
 */
export async function postSchedule(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<ScheduleResponse> {
  return request<ScheduleResponse>("/schedule", {
    method: "POST",
    accessToken,
    body: credentials,
  });
}

/**
 * Logs in to SIGAA and returns a live session cookie for the "Abrir o SIGAA" button —
 * meant to be injected into a WebView's cookie store, not parsed as data. Distinct
 * from postSchedule: that endpoint returns our own parsed data, this one hands off
 * to the real sigaa.ufba.br site.
 */
export async function postSigaaSession(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<SigaaWebSession> {
  return request<SigaaWebSession>("/sigaa/session", {
    method: "POST",
    accessToken,
    body: credentials,
  });
}

/**
 * Fetches the freshest user record — the academic fields (matrícula, curso,
 * período de ingresso) only exist server-side after a schedule fetch, so the
 * user object stored at login time goes stale and needs this refresh.
 */
export async function getMe(accessToken: string): Promise<GoogleUserInfo> {
  return request<GoogleUserInfo>("/users/me", { method: "GET", accessToken });
}

/** Saves the DiceBear avatar URL the user picked in the avatar picker screen. */
export async function postAvatar(accessToken: string, avatarUrl: string): Promise<{ avatarUrl: string }> {
  return request<{ avatarUrl: string }>("/users/me/avatar", {
    method: "POST",
    accessToken,
    body: { avatarUrl },
  });
}

/**
 * Fetches the transcript ("Histórico Escolar") as raw PDF bytes, straight from
 * SIGAA — not through `request()`, since that always parses the response as
 * JSON and this one is binary.
 */
export async function postSigaaHistorico(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<Uint8Array> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SIGAA_DOCUMENT_TIMEOUT_MS);

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/sigaa/historico`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(credentials),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  console.log(
    `[DEBUG] fetch resolved after ${Date.now() - t0}ms, status=${response.status}, content-length=${response.headers?.get?.("content-length")}`,
  );

  if (!response.ok) {
    throw new ApiError(`Request to /sigaa/historico failed with status ${response.status}`, response.status);
  }

  const t1 = Date.now();
  const buffer = await response.arrayBuffer();
  console.log(`[DEBUG] arrayBuffer resolved after ${Date.now() - t1}ms, bytes=${buffer.byteLength}`);
  if (buffer.byteLength === 0) {
    // A real histórico PDF is never empty — this shape (2xx, empty body) is
    // what an aborted/broken fetch looks like on some polyfills instead of a
    // rejection, so treat it as a failure rather than "successfully" saving
    // a 0-byte file.
    throw new ApiError("Received an empty response from /sigaa/historico");
  }
  return new Uint8Array(buffer);
}

/**
 * Fetches the atestado de matrícula as a *self-contained HTML document* (assets
 * inlined, scripts stripped by the backend) for the device to render to a PDF
 * via expo-print. Unlike histórico, SIGAA doesn't serve this one as a PDF byte
 * stream — it's HTML text, hence `response.text()` rather than `arrayBuffer()`
 * (and not `request()`, which always parses JSON). See
 * ATESTADO_MATRICULA_INVESTIGATION.md.
 */
export async function postSigaaAtestado(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<string> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SIGAA_DOCUMENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/sigaa/atestado`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(credentials),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ApiError(`Request to /sigaa/atestado failed with status ${response.status}`, response.status);
  }

  const html = await response.text();
  if (html.length === 0) {
    // A 2xx with an empty body is what an aborted/broken fetch looks like on
    // some polyfills — treat it as a failure rather than rendering a blank PDF.
    throw new ApiError("Received an empty response from /sigaa/atestado");
  }
  return html;
}
