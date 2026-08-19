import type { SigaaCredentials, Session, Turma } from "./types";

export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

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
 * Fetches the student's current-semester turmas from the SIGAA portal home.
 * POST (not GET) because credentials travel in the body, and a spec-compliant
 * fetch client can't send a body on a GET request.
 */
export async function postSchedule(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<Turma[]> {
  return request<Turma[]>("/schedule", {
    method: "POST",
    accessToken,
    body: credentials,
  });
}
