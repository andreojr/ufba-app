import type {
  AppRelease,
  DocentePerfil,
  DocenteResumo,
  GoogleUserInfo,
  ItemPlano,
  ScheduleResponse,
  SigaaCredentials,
  SigaaWebSession,
  Session,
  TrajetoriaResponse,
  VizinhosCurricularesResponse,
} from "./types";

export class ApiError extends Error {
  status?: number;
  /** The backend's machine-readable tag for this failure, when it sent one. */
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The tag the backend puts on the one 401 that means "SIGAA said no to this password". */
const SIGAA_INVALID_CREDENTIALS_CODE = "SIGAA_INVALID_CREDENTIALS";

/** What the last call that carried the SIGAA password learned about it. */
export type SigaaCredentialsVerdict = "accepted" | "rejected";

type VerdictListener = (verdict: SigaaCredentialsVerdict) => void;

const verdictListeners = new Set<VerdictListener>();

/**
 * Subscribes to what the API layer learns about the stored SIGAA password.
 *
 * Every screen that touches SIGAA — Início, Trajetória, Insights, Professores,
 * documentos, o sync do Perfil, "Abrir o SIGAA" — can hit a rejected password,
 * and each one already shows its own message. Rather than teach all of them to
 * also mark the credential stale (and remember to teach the next one), the
 * request layer reports the verdict once, here, and SigaaLinkProvider listens.
 *
 * Returns the unsubscribe function.
 */
export function onSigaaCredentialsVerdict(listener: VerdictListener): () => void {
  verdictListeners.add(listener);
  return () => {
    verdictListeners.delete(listener);
  };
}

function reportVerdict(verdict: SigaaCredentialsVerdict): void {
  for (const listener of verdictListeners) {
    listener(verdict);
  }
}

/** Reads the error `code` off a failed response body, if the backend sent one. */
function readErrorCode(body: unknown): string | undefined {
  return body && typeof body === "object" && "code" in body
    ? String((body as { code: unknown }).code)
    : undefined;
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
  method: "GET" | "POST" | "DELETE" | "PUT";
  body?: unknown;
  accessToken?: string;
  /** Overrides the default timeout; the SIGAA scrape endpoints need far longer. */
  timeoutMs?: number;
  /**
   * True when the body carries the *stored* SIGAA password, so the outcome is a
   * verdict on it. Deliberately false for POST /sigaa/link: the password there
   * is a candidate the user just typed, and a typo in it says nothing about the
   * credential already saved on the device.
   */
  carriesStoredSigaaPassword?: boolean;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

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
    const code = readErrorCode(body);
    if (code === SIGAA_INVALID_CREDENTIALS_CODE && options.carriesStoredSigaaPassword) {
      reportVerdict("rejected");
    }
    throw new ApiError(message, response.status, code);
  }

  if (options.carriesStoredSigaaPassword) {
    reportVerdict("accepted");
  }

  // 204 has no body — calling .json() on it throws. The erasure endpoints
  // answer this way: success is the absence of anything to say.
  if (response.status === 204) {
    return undefined as T;
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

/** Reads the cached schedule. Cheap — this hits our own database, not SIGAA. */
/**
 * Public on purpose — the app checks for updates before anyone has signed in,
 * so no access token travels here.
 */
export async function getAppVersion(): Promise<AppRelease> {
  return request<AppRelease>("/app/version", { method: "GET" });
}

export async function getSchedule(accessToken: string): Promise<ScheduleResponse> {
  return request<ScheduleResponse>("/schedule", { method: "GET", accessToken });
}

/**
 * Re-scrapes the student's current-term turmas, plus the term's own start/end
 * dates, off their atestado de matrícula, persists them, then returns the
 * fresh aggregate — so the screen renders without a second round trip. POST
 * (not GET) because credentials travel in the body, and a spec-compliant
 * fetch client can't send a body on a GET request.
 */
export async function postScheduleSync(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<ScheduleResponse> {
  return request<ScheduleResponse>("/schedule/sync", {
    method: "POST",
    accessToken,
    body: credentials,
    timeoutMs: SIGAA_DOCUMENT_TIMEOUT_MS,
    carriesStoredSigaaPassword: true,
  });
}

/**
 * Logs in to SIGAA and returns a live session cookie for the "Abrir o SIGAA" button —
 * meant to be injected into a WebView's cookie store, not parsed as data. Distinct
 * from getSchedule/postScheduleSync: those return our own parsed data, this one hands
 * off to the real sigaa.ufba.br site.
 */
export async function postSigaaSession(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<SigaaWebSession> {
  return request<SigaaWebSession>("/sigaa/session", {
    method: "POST",
    accessToken,
    body: credentials,
    carriesStoredSigaaPassword: true,
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
 * Hard-deletes the account and, by cascade, every trace of this student on the
 * server. There is no partial variant on purpose: coming back costs one Google
 * sign-in, so a half-erasure would add a choice without adding any safety.
 */
export async function deleteAccount(accessToken: string): Promise<void> {
  await request<void>("/users/me", { method: "DELETE", accessToken });
}

/**
 * The document endpoints answer with bytes/HTML, so they build their fetch by
 * hand instead of going through `request()` — which means they'd otherwise miss
 * the JSON error body, and with it the tag that says the password was rejected.
 */
async function failedDocumentResponse(response: Response, path: string): Promise<ApiError> {
  // These endpoints answer with bytes or HTML, so an error body being JSON is a
  // convention, not a guarantee — and `json` may not even exist on whatever the
  // platform's fetch handed back. Either way, no tag: just a plain failure.
  const body: unknown = await Promise.resolve()
    .then(() => response.json())
    .catch(() => null);
  const code = readErrorCode(body);
  if (code === SIGAA_INVALID_CREDENTIALS_CODE) {
    reportVerdict("rejected");
  }
  return new ApiError(`Request to ${path} failed with status ${response.status}`, response.status, code);
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
    throw await failedDocumentResponse(response, "/sigaa/historico");
  }
  reportVerdict("accepted");

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
    throw await failedDocumentResponse(response, "/sigaa/atestado");
  }
  reportVerdict("accepted");

  const html = await response.text();
  if (html.length === 0) {
    // A 2xx with an empty body is what an aborted/broken fetch looks like on
    // some polyfills — treat it as a failure rather than rendering a blank PDF.
    throw new ApiError("Received an empty response from /sigaa/atestado");
  }
  return html;
}

/** Reads the stored trajectory. Cheap — this hits our own database, not SIGAA. */
export async function getTrajetoria(accessToken: string): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria", { method: "GET", accessToken });
}

/**
 * Re-scrapes and re-parses the transcript server-side, then returns the fresh
 * aggregate — so the screen renders without a second round trip after a wait
 * long enough to need a progress indicator.
 *
 * This stays the primary path forever, not just until a background job exists:
 * a user on `syncMode: "device"` keeps their credential off our servers, so no
 * server-side job can ever refresh their trajectory.
 */
export async function postTrajetoriaSync(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria/sync", {
    method: "POST",
    accessToken,
    body: credentials,
    timeoutMs: SIGAA_DOCUMENT_TIMEOUT_MS,
  });
}

// The first call for a set of docentes resolves them against SIGAA (one search
// POST each, serial, plus three profile GETs each) — far past the default
// timeout. Subsequent calls hit the backend's global cache and are instant.
const DOCENTES_TIMEOUT_MS = 60_000;

export async function postDocentesSemestre(
  accessToken: string,
  turmas: { codigo: string; nome: string; docente: string }[],
): Promise<DocenteResumo[]> {
  return request<DocenteResumo[]>("/docentes/semestre", {
    method: "POST",
    body: { turmas },
    accessToken,
    timeoutMs: DOCENTES_TIMEOUT_MS,
  });
}

export async function getDocente(
  accessToken: string,
  siape: string,
): Promise<DocentePerfil> {
  return request<DocentePerfil>(`/docentes/${siape}`, { method: "GET", accessToken });
}

// getVizinhosCurriculares delegates to CurriculoService.resolverCurso/
// resolverPorNomeUsuario — pode disparar um scraping ao vivo completo do
// SIGAA na primeira resolução de um curso. Reaproveita o mesmo orçamento de
// timeout das outras chamadas baseadas em scraping.
const VIZINHOS_CURRICULARES_TIMEOUT_MS = SIGAA_DOCUMENT_TIMEOUT_MS;

/**
 * Vizinhos diretos (pré-requisitos + o que desbloqueia) de `codigo` dentro
 * da grade ativa do curso do usuário logado, com a situação (cursada/em
 * curso/liberada/bloqueada) de cada um. Mesma conveniência de
 * `/curriculo/meu-curso`: recebe o nome bruto de `User.curso` em vez de
 * resolver `cursoId` num passo à parte.
 */
export async function getVizinhosCurriculares(
  accessToken: string,
  curso: string,
  codigo: string,
): Promise<VizinhosCurricularesResponse> {
  return request<VizinhosCurricularesResponse>(
    `/curriculo/meu-curso/componentes/${encodeURIComponent(codigo)}/vizinhos?curso=${encodeURIComponent(curso)}`,
    { method: "GET", accessToken, timeoutMs: VIZINHOS_CURRICULARES_TIMEOUT_MS },
  );
}

/** Saves the positions the student chose and returns the re-projected trajectory. */
export async function putPlano(
  accessToken: string,
  itens: ItemPlano[],
): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria/plano", {
    method: "PUT",
    accessToken,
    body: { itens },
  });
}
