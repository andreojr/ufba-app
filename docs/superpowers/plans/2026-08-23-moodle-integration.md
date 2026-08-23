# Moodle (AVA UFBA) Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o usuário conecte a conta do AVA UFBA (Moodle) uma única vez, guardando no aparelho um token de leitura. **Somente a conexão** — nenhuma leitura de conteúdo, nenhuma tela nova. Consumir os dados (turmas, materiais, etc.) é assunto de specs posteriores (página de turma virtual, item C do ROADMAP).

**Architecture:** Subsistema mobile puro (sem backend). Captura o token de web service do Moodle pelo fluxo oficial do app móvel (SSO Shibboleth → custom scheme), guarda o token só no device (`expo-secure-store`), e valida a conexão com `core_webservice_get_site_info`. Espelha o padrão já usado pelo SIGAA (`sigaa-storage.ts` + `sigaa-link-context.tsx`).

**Tech Stack:** React Native / Expo ~54, TypeScript, `expo-web-browser` (novo), `expo-crypto` (novo, para MD5 da assinatura), `expo-secure-store`, Jest + React Native Testing Library v14.

**Spec:** `docs/superpowers/specs/2026-08-23-moodle-integration-design.md`

## Global Constraints

- **Somente conexão:** este plano para na conexão da conta. Nenhuma leitura de conteúdo (turmas/materiais/avisos/tarefas), nenhum contrato de dados agnóstico, nenhuma tela nova. A única função WS chamada é `core_webservice_get_site_info`, para validar o token e obter o `userId`.
- **Token nunca sai do device:** sem endpoint de backend, sem persistência em nuvem. Único armazenamento é `expo-secure-store`.
- **Senha nunca toca o app:** digitada apenas no IdP dentro de `WebBrowser.openAuthSessionAsync`.
- **Scheme atual:** `ufba-app` (em `mobile/app.json`, `expo.scheme`).
- **Comando de teste:** `cd mobile && npx jest <path>`. Typecheck: `npx tsc --noEmit`.
- **Convenção de testes:** specs co-locados; para os de UI, `mobile/src/__tests__/*.test.tsx`; para libs, `*.test.ts` ao lado do arquivo. Timers assíncronos: render async + drenar antes de `useRealTimers` (prática do projeto).
- **Idioma da UI e mensagens:** português (pt-BR), como o resto do app.

---

### Task 1: Sessão persistida do Moodle (`moodle-storage.ts`)

**Files:**
- Create: `mobile/src/lib/moodle-storage.ts`
- Test: `mobile/src/lib/moodle-storage.test.ts`

**Interfaces:**
- Consumes: `expo-secure-store` (`getItemAsync`/`setItemAsync`/`deleteItemAsync`).
- Produces:
  - `type MoodleSession = { wstoken: string; privatetoken?: string; siteUrl: string; userId: number }`
  - `getMoodleSession(): Promise<MoodleSession | null>`
  - `saveMoodleSession(session: MoodleSession): Promise<void>`
  - `clearMoodleSession(): Promise<void>`
  - `hasEverLinkedMoodle(): Promise<boolean>`
  - `rememberMoodleWasLinked(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/lib/moodle-storage.test.ts
import * as SecureStore from "expo-secure-store";

import {
  clearMoodleSession,
  getMoodleSession,
  hasEverLinkedMoodle,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

jest.mock("expo-secure-store");

const mockStore = SecureStore as jest.Mocked<typeof SecureStore>;

const validSession: MoodleSession = {
  wstoken: "abc123",
  siteUrl: "https://ava.ufba.br",
  userId: 42,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("moodle-storage", () => {
  it("returns the parsed session when storage holds a valid one", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(validSession));
    await expect(getMoodleSession()).resolves.toEqual(validSession);
  });

  it("returns null when storage is empty", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("returns null when the stored JSON is corrupt", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce("{not json");
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("returns null when the stored object is missing required fields", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({ wstoken: "x" }));
    await expect(getMoodleSession()).resolves.toBeNull();
  });

  it("persists the session as JSON under the moodle key", async () => {
    await saveMoodleSession(validSession);
    expect(mockStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.moodle",
      JSON.stringify(validSession),
    );
  });

  it("clears the session", async () => {
    await clearMoodleSession();
    expect(mockStore.deleteItemAsync).toHaveBeenCalledWith("gradline.moodle");
  });

  it("remembers and reports that the account was ever linked", async () => {
    await rememberMoodleWasLinked();
    expect(mockStore.setItemAsync).toHaveBeenCalledWith("gradline.moodle.jaVinculou", "1");

    mockStore.getItemAsync.mockResolvedValueOnce("1");
    await expect(hasEverLinkedMoodle()).resolves.toBe(true);
  });

  it("reports not-ever-linked when the flag is absent", async () => {
    mockStore.getItemAsync.mockResolvedValueOnce(null);
    await expect(hasEverLinkedMoodle()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/moodle-storage.test.ts`
Expected: FAIL (module `./moodle-storage` not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// mobile/src/lib/moodle-storage.ts
import * as SecureStore from "expo-secure-store";

const MOODLE_KEY = "gradline.moodle";
const EVER_LINKED_KEY = "gradline.moodle.jaVinculou";

export type MoodleSession = {
  wstoken: string;
  privatetoken?: string;
  siteUrl: string;
  userId: number;
};

function isMoodleSession(value: unknown): value is MoodleSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MoodleSession).wstoken === "string" &&
    typeof (value as MoodleSession).siteUrl === "string" &&
    typeof (value as MoodleSession).userId === "number"
  );
}

export async function getMoodleSession(): Promise<MoodleSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(MOODLE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isMoodleSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveMoodleSession(session: MoodleSession): Promise<void> {
  await SecureStore.setItemAsync(MOODLE_KEY, JSON.stringify(session));
}

export async function clearMoodleSession(): Promise<void> {
  await SecureStore.deleteItemAsync(MOODLE_KEY);
}

export async function rememberMoodleWasLinked(): Promise<void> {
  await SecureStore.setItemAsync(EVER_LINKED_KEY, "1");
}

export async function hasEverLinkedMoodle(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(EVER_LINKED_KEY)) === "1";
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/moodle-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/moodle-storage.ts mobile/src/lib/moodle-storage.test.ts
git commit -m "feat(mobile): armazenamento local da sessão Moodle"
```

---

### Task 2: Parse e verificação do token de retorno (`moodle-auth.ts`, parte pura)

Adiciona `expo-crypto` e implementa as funções **puras** de parsing/validação do token que o Moodle devolve no custom scheme. O disparo real do browser vem na Task 3.

**Files:**
- Create: `mobile/src/lib/moodle-auth.ts`
- Test: `mobile/src/lib/moodle-auth.test.ts`
- Modify: `mobile/package.json` (adiciona `expo-crypto`)

**Interfaces:**
- Consumes: `expo-crypto` (`digestStringAsync`, `CryptoDigestAlgorithm.MD5`).
- Produces:
  - `type ParsedMoodleToken = { signature: string; wstoken: string; privatetoken?: string }`
  - `parseReturnedToken(base64: string): ParsedMoodleToken` — decodifica base64 e faz split por `":::"`. Lança `Error` se não houver ao menos assinatura + token.
  - `verifyPassport(signature: string, siteUrl: string, passport: string): Promise<boolean>` — verdadeiro sse `signature === md5(siteUrl + passport)`. (Mesmo algoritmo do `validateBrowserReturnToken` do app oficial do Moodle: assinatura = `Md5(siteUrl + passport)`.)

**Contexto de implementação:** primeiro instale a dependência.
```bash
cd mobile && npx expo install expo-crypto
```

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/lib/moodle-auth.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/moodle-auth.test.ts`
Expected: FAIL (module `./moodle-auth` not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// mobile/src/lib/moodle-auth.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/moodle-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/moodle-auth.ts mobile/src/lib/moodle-auth.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): parse e verificação do token de retorno do Moodle"
```

---

### Task 3: Fluxo de login via browser (`moodle-auth.ts`, `startMoodleLogin`)

Adiciona `expo-web-browser` e a função que dispara o SSO e devolve uma sessão pronta. Compõe as funções puras da Task 2 com `core_webservice_get_site_info` (definido na Task 4 — mas esta task só depende da assinatura dele, injetada como parâmetro para manter o teste isolado).

Para evitar dependência circular com a Task 4, `startMoodleLogin` recebe um callback `resolveSiteInfo` que, dado um `wstoken`+`siteUrl`, retorna `{ userId }`. Na composição real (Task 5) passamos `getSiteInfo` da Task 4.

**Files:**
- Modify: `mobile/src/lib/moodle-auth.ts`
- Modify: `mobile/src/lib/moodle-auth.test.ts`
- Modify: `mobile/package.json` (adiciona `expo-web-browser`)

**Interfaces:**
- Consumes: `expo-web-browser` (`openAuthSessionAsync`), `parseReturnedToken`, `verifyPassport` (Task 2).
- Produces:
  - `const MOODLE_SITE_URL = "https://ava.ufba.br"`
  - `const MOODLE_RETURN_SCHEME = "ufba-app"`
  - `type MoodleLoginResult = { status: "success"; session: MoodleSession } | { status: "cancelled" } | { status: "failed"; reason: string }`
  - `startMoodleLogin(resolveUserId: (wstoken: string, siteUrl: string) => Promise<number>): Promise<MoodleLoginResult>`
    - Gera `passport = String(Math.random())`.
    - Monta `launchUrl = ${MOODLE_SITE_URL}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=${MOODLE_RETURN_SCHEME}`.
    - `WebBrowser.openAuthSessionAsync(launchUrl, "${MOODLE_RETURN_SCHEME}://token")`.
    - `type !== "success"` → `{ status: "cancelled" }`.
    - Extrai `token=` da URL de retorno, `parseReturnedToken`, `verifyPassport`. Falha → `{ status: "failed", reason }`.
    - Sucesso → `resolveUserId` → `{ status: "success", session }`.

**Contexto de implementação:** instale a dependência.
```bash
cd mobile && npx expo install expo-web-browser
```

- [ ] **Step 1: Write the failing test**

```typescript
// append to mobile/src/lib/moodle-auth.test.ts
import * as WebBrowser from "expo-web-browser";

import { MOODLE_RETURN_SCHEME, startMoodleLogin } from "./moodle-auth";

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
}));

const mockBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/moodle-auth.test.ts`
Expected: FAIL (`startMoodleLogin` / `MOODLE_RETURN_SCHEME` not exported).

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to mobile/src/lib/moodle-auth.ts
import * as WebBrowser from "expo-web-browser";

import type { MoodleSession } from "./moodle-storage";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/moodle-auth.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/moodle-auth.ts mobile/src/lib/moodle-auth.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): fluxo de login SSO do Moodle via openAuthSessionAsync"
```

---

### Task 4: Cliente REST mínimo do Moodle (`moodle-api.ts`)

Apenas o necessário para **validar a conexão**: `callMoodle` + `getSiteInfo` + o verdict de token expirado. Nenhuma função de conteúdo (turmas, materiais, arquivos) — isso pertence a specs posteriores.

**Files:**
- Create: `mobile/src/lib/moodle-api.ts`
- Test: `mobile/src/lib/moodle-api.test.ts`

**Interfaces:**
- Consumes: `MoodleSession` (Task 1), `fetch`, `ApiError` (de `./api`).
- Produces:
  - `type MoodleTokenVerdict = "valid" | "expired"`
  - `onMoodleTokenVerdict(listener: (v: MoodleTokenVerdict) => void): () => void`
  - `type MoodleSiteInfo = { userId: number }`
  - `callMoodle<T>(session: MoodleSession, wsfunction: string, params?: Record<string, string>): Promise<T>`
  - `getSiteInfo(session: MoodleSession): Promise<MoodleSiteInfo>`

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/lib/moodle-api.test.ts
import { ApiError } from "./api";
import { callMoodle, getSiteInfo, onMoodleTokenVerdict } from "./moodle-api";
import type { MoodleSession } from "./moodle-storage";

const session: MoodleSession = {
  wstoken: "tok",
  siteUrl: "https://ava.ufba.br",
  userId: 42,
};

function mockFetchOnce(body: unknown): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

describe("callMoodle", () => {
  it("posts wstoken, wsfunction and json format", async () => {
    mockFetchOnce({ ok: true });
    await callMoodle(session, "core_webservice_get_site_info");

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://ava.ufba.br/webservice/rest/server.php");
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("wstoken")).toBe("tok");
    expect(sent.get("wsfunction")).toBe("core_webservice_get_site_info");
    expect(sent.get("moodlewsrestformat")).toBe("json");
  });

  it("throws MOODLE_INVALID_TOKEN and notifies listeners on invalidtoken", async () => {
    mockFetchOnce({ exception: "moodle_exception", errorcode: "invalidtoken", message: "x" });
    const listener = jest.fn();
    const unsub = onMoodleTokenVerdict(listener);

    await expect(callMoodle(session, "core_webservice_get_site_info")).rejects.toMatchObject({
      code: "MOODLE_INVALID_TOKEN",
    });
    expect(listener).toHaveBeenCalledWith("expired");
    unsub();
  });

  it("throws a generic ApiError on other exceptions", async () => {
    mockFetchOnce({ exception: "moodle_exception", errorcode: "nopermission", message: "no" });
    await expect(callMoodle(session, "whatever")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getSiteInfo", () => {
  it("maps the user id", async () => {
    mockFetchOnce({ userid: 7, functions: [{ name: "core_course_get_contents" }] });
    await expect(getSiteInfo(session)).resolves.toEqual({ userId: 7 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/moodle-api.test.ts`
Expected: FAIL (module `./moodle-api` not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// mobile/src/lib/moodle-api.ts
import { ApiError } from "./api";
import type { MoodleSession } from "./moodle-storage";

export type MoodleTokenVerdict = "valid" | "expired";
type VerdictListener = (verdict: MoodleTokenVerdict) => void;
const verdictListeners = new Set<VerdictListener>();

export function onMoodleTokenVerdict(listener: VerdictListener): () => void {
  verdictListeners.add(listener);
  return () => {
    verdictListeners.delete(listener);
  };
}

function reportVerdict(verdict: MoodleTokenVerdict): void {
  for (const listener of verdictListeners) {
    listener(verdict);
  }
}

export type MoodleSiteInfo = { userId: number };

function isMoodleException(
  body: unknown,
): body is { exception: string; errorcode: string; message: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { exception?: unknown }).exception === "string"
  );
}

export async function callMoodle<T>(
  session: MoodleSession,
  wsfunction: string,
  params: Record<string, string> = {},
): Promise<T> {
  const body = new URLSearchParams({
    wstoken: session.wstoken,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });

  const response = await fetch(`${session.siteUrl}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json: unknown = await response.json();

  if (isMoodleException(json)) {
    if (json.errorcode === "invalidtoken") {
      reportVerdict("expired");
      throw new ApiError(json.message, response.status, "MOODLE_INVALID_TOKEN");
    }
    throw new ApiError(json.message, response.status, json.errorcode);
  }

  return json as T;
}

export async function getSiteInfo(session: MoodleSession): Promise<MoodleSiteInfo> {
  const raw = await callMoodle<{ userid: number }>(
    session,
    "core_webservice_get_site_info",
  );
  return { userId: raw.userid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/moodle-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/moodle-api.ts mobile/src/lib/moodle-api.test.ts
git commit -m "feat(mobile): cliente REST mínimo do Moodle (validação de conexão)"
```

---

### Task 5: Contexto de vínculo (`moodle-link-context.tsx`)

**Files:**
- Create: `mobile/src/lib/moodle-link-context.tsx`
- Test: `mobile/src/lib/moodle-link-context.test.tsx`

**Interfaces:**
- Consumes: `getMoodleSession`/`saveMoodleSession`/`clearMoodleSession`/`rememberMoodleWasLinked` (Task 1), `startMoodleLogin` (Task 3), `getSiteInfo`/`onMoodleTokenVerdict` (Task 4).
- Produces:
  - `type MoodleLinkState = { status: "loading" } | { status: "unlinked" } | { status: "linked"; session: MoodleSession; expired: boolean }`
  - `MoodleLinkProvider(props: PropsWithChildren): JSX.Element`
  - `useMoodleLink(): MoodleLinkState & { link: () => Promise<MoodleLoginResult>; unlink: () => Promise<void> }`
  - Comportamento de `link()`: chama `startMoodleLogin((wstoken, siteUrl) => getSiteInfo({ wstoken, siteUrl, userId: 0 }).then(i => i.userId))`. Em `success`: salva sessão, `rememberMoodleWasLinked`, seta `linked`. Retorna o `MoodleLoginResult` para a UI decidir toast.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/lib/moodle-link-context.test.tsx
import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { startMoodleLogin } from "./moodle-auth";
import { getSiteInfo } from "./moodle-api";
import { MoodleLinkProvider, useMoodleLink } from "./moodle-link-context";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
} from "./moodle-storage";

jest.mock("./moodle-storage");
jest.mock("./moodle-auth");
jest.mock("./moodle-api", () => ({
  ...jest.requireActual("./moodle-api"),
  getSiteInfo: jest.fn(),
}));

const mockGetSession = getMoodleSession as jest.Mock;
const mockSave = saveMoodleSession as jest.Mock;
const mockStart = startMoodleLogin as jest.Mock;

function Probe(): JSX.Element {
  const link = useMoodleLink();
  return <Text testID="status">{link.status}</Text>;
}

beforeEach(() => jest.clearAllMocks());

it("hydrates to unlinked when there is no stored session", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  const screen = render(
    <MoodleLinkProvider>
      <Probe />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));
});

it("hydrates to linked when a session is stored", async () => {
  mockGetSession.mockResolvedValueOnce({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 });
  const screen = render(
    <MoodleLinkProvider>
      <Probe />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
});

it("link() saves the session on success", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  mockStart.mockResolvedValueOnce({
    status: "success",
    session: { wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 },
  });

  let linkFn: () => Promise<unknown> = async () => undefined;
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    linkFn = ctx.link;
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));

  await act(async () => {
    await linkFn();
  });

  expect(mockSave).toHaveBeenCalledWith({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 });
  expect(rememberMoodleWasLinked).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
  void clearMoodleSession;
  void getSiteInfo;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/lib/moodle-link-context.test.tsx`
Expected: FAIL (module `./moodle-link-context` not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// mobile/src/lib/moodle-link-context.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type PropsWithChildren,
} from "react";

import { startMoodleLogin, type MoodleLoginResult } from "./moodle-auth";
import { getSiteInfo, onMoodleTokenVerdict } from "./moodle-api";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

type MoodleLinkState =
  | { status: "loading" }
  | { status: "unlinked" }
  | { status: "linked"; session: MoodleSession; expired: boolean };

type MoodleLinkContextValue = MoodleLinkState & {
  link: () => Promise<MoodleLoginResult>;
  unlink: () => Promise<void>;
};

const MoodleLinkContext = createContext<MoodleLinkContextValue | undefined>(undefined);

export function MoodleLinkProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<MoodleLinkState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    void getMoodleSession().then((session) => {
      if (!mounted) return;
      setState(session ? { status: "linked", session, expired: false } : { status: "unlinked" });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return onMoodleTokenVerdict((verdict) => {
      setState((current) =>
        current.status === "linked"
          ? { ...current, expired: verdict === "expired" }
          : current,
      );
    });
  }, []);

  const link = useCallback(async (): Promise<MoodleLoginResult> => {
    const result = await startMoodleLogin((wstoken, siteUrl) =>
      getSiteInfo({ wstoken, siteUrl, userId: 0 }).then((info) => info.userId),
    );
    if (result.status === "success") {
      await saveMoodleSession(result.session);
      void rememberMoodleWasLinked().catch((error: unknown) => {
        console.warn("Failed to record Moodle link", error);
      });
      setState({ status: "linked", session: result.session, expired: false });
    }
    return result;
  }, []);

  const unlink = useCallback(async () => {
    await clearMoodleSession();
    setState({ status: "unlinked" });
  }, []);

  const value = useMemo<MoodleLinkContextValue>(
    () => ({ ...state, link, unlink }),
    [state, link, unlink],
  );

  return <MoodleLinkContext.Provider value={value}>{children}</MoodleLinkContext.Provider>;
}

export function useMoodleLink(): MoodleLinkContextValue {
  const context = useContext(MoodleLinkContext);
  if (!context) {
    throw new Error("useMoodleLink must be used within a MoodleLinkProvider");
  }
  return context;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/lib/moodle-link-context.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/moodle-link-context.tsx mobile/src/lib/moodle-link-context.test.tsx
git commit -m "feat(mobile): contexto de vínculo do Moodle"
```

---

### Task 6: Montar o provider e habilitar o item em Ajustes

**Files:**
- Modify: `mobile/src/app/_layout.tsx` (montar `MoodleLinkProvider`)
- Modify: `mobile/src/app/(tabs)/ajustes.tsx` (habilitar `link-moodle-item`)
- Modify: `mobile/src/__tests__/ajustes.test.tsx`

**Interfaces:**
- Consumes: `useMoodleLink` (Task 5).
- Produces: nenhuma nova API — apenas ligações de UI.

**Contexto de implementação:**
- Em `_layout.tsx`, envolver a árvore com `MoodleLinkProvider` (não depende de auth; pode ficar ao lado de `SigaaLinkProvider`).
- Em `ajustes.tsx`, no item `link-moodle-item` (hoje em `mobile/src/app/(tabs)/ajustes.tsx:729`): remover `disabled` e `className="opacity-50"`; remover o `<Chip>Em breve</Chip>`. Ler `const moodle = useMoodleLink();`. `onPress` (**sem navegação — não existe tela de Moodle**):
  - `moodle.status === "unlinked"` → `await moodle.link()`; se `result.status === "failed"`, `toast.show("Não foi possível conectar ao Moodle. Tente novamente.")`; `cancelled` não mostra toast.
  - `moodle.status === "linked"` → abre um diálogo de confirmação "Desvincular Moodle?"; confirmando, chama `moodle.unlink()`. Reutilize o padrão de `Dialog`/`Dialog.Portal` já presente nesta tela.
- Sufixo do item reflete estado: `linked` → `<Chip>Conectado</Chip>` (e, se `moodle.expired`, `<Chip>Reconectar</Chip>`); `unlinked` → sem chip.

- [ ] **Step 1: Write the failing test**

```typescript
// add to mobile/src/__tests__/ajustes.test.tsx
// (near the other jest.mock calls at the top)
jest.mock("@/lib/moodle-link-context");

// (inside the describe block)
import { within } from "@testing-library/react-native";
import { useMoodleLink } from "@/lib/moodle-link-context";

const mockUseMoodleLink = useMoodleLink as jest.Mock;

// Give every OTHER test in this file a sane default so the new mock does not
// break them: add this in the file's beforeEach (or right after the existing
// default mocks), e.g.
//   mockUseMoodleLink.mockReturnValue({ status: "unlinked", link: jest.fn(), unlink: jest.fn() });

it("enables the Moodle item and starts linking when tapped while unlinked", async () => {
  const link = jest.fn().mockResolvedValue({ status: "cancelled" });
  mockUseMoodleLink.mockReturnValue({ status: "unlinked", link, unlink: jest.fn() });

  const screen = renderAjustes(); // reuse the file's existing render helper/pattern

  const item = await screen.findByTestId("link-moodle-item");
  expect(item.props.accessibilityState?.disabled).toBeFalsy();
  expect(within(item).queryByText("Em breve")).toBeNull();

  await act(async () => {
    fireEvent.press(item);
  });
  expect(link).toHaveBeenCalled();
});

it("shows 'Conectado' and offers unlink when already linked", async () => {
  const unlink = jest.fn().mockResolvedValue(undefined);
  mockUseMoodleLink.mockReturnValue({
    status: "linked",
    expired: false,
    session: { wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 },
    link: jest.fn(),
    unlink,
  });

  const screen = renderAjustes();
  const item = await screen.findByTestId("link-moodle-item");
  expect(within(item).getByText("Conectado")).toBeTruthy();

  await act(async () => {
    fireEvent.press(item);
  });
  // Confirmation dialog appears; confirm it.
  await act(async () => {
    fireEvent.press(screen.getByText("Desvincular"));
  });
  expect(unlink).toHaveBeenCalled();
});
```

> Nota para o executor: reutilize o helper/props de render de `AjustesTab` já presente neste arquivo (mocks de `auth-context`, `sigaa-link-context`, etc.). Como há dois itens com "Em breve" (Moodle e Classroom), asserte a ausência do chip via `within(item)`, não global. O texto exato do botão de confirmação ("Desvincular") deve casar com o que o `Dialog` renderiza.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/__tests__/ajustes.test.tsx`
Expected: FAIL (item ainda `disabled`; `useMoodleLink` não usado pela tela).

- [ ] **Step 3: Write minimal implementation**

Monte `MoodleLinkProvider` em `_layout.tsx`; em `ajustes.tsx` troque o item placeholder por:

```tsx
<ListGroup.Item testID="link-moodle-item" onPress={handleMoodlePress}>
  <ListGroup.ItemPrefix>
    <MoodleIcon size={22} />
  </ListGroup.ItemPrefix>
  <ListGroup.ItemContent>
    <ListGroup.ItemTitle>Vincular Moodle</ListGroup.ItemTitle>
    <ListGroup.ItemDescription>Materiais e avisos das suas salas</ListGroup.ItemDescription>
  </ListGroup.ItemContent>
  <ListGroup.ItemSuffix>
    {moodle.status === "linked" ? (
      <Chip variant="secondary" size="sm">
        {moodle.expired ? "Reconectar" : "Conectado"}
      </Chip>
    ) : null}
  </ListGroup.ItemSuffix>
</ListGroup.Item>
```

Com o handler e o estado do diálogo no corpo do componente (reaproveitando o `Dialog` já usado na tela):

```tsx
const moodle = useMoodleLink();
const [confirmMoodleUnlink, setConfirmMoodleUnlink] = useState(false);

const handleMoodlePress = async (): Promise<void> => {
  if (moodle.status === "linked") {
    setConfirmMoodleUnlink(true);
    return;
  }
  if (moodle.status === "unlinked") {
    const result = await moodle.link();
    if (result.status === "failed") {
      toast.show("Não foi possível conectar ao Moodle. Tente novamente.");
    }
  }
};
```

E um `Dialog` de confirmação (mesmo padrão do que já existe na tela) com um botão "Desvincular" que chama `moodle.unlink()` e fecha, e um "Cancelar" que só fecha. (Use o mesmo `useToast()` já importado na tela; ajuste nomes conforme o arquivo.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/__tests__/ajustes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/_layout.tsx "mobile/src/app/(tabs)/ajustes.tsx" mobile/src/__tests__/ajustes.test.tsx
git commit -m "feat(mobile): habilitar vínculo/desvínculo do Moodle em Ajustes"
```

---

### Task 7: Verificação final (typecheck, lint, suite completa) e spikes de campo

**Files:** nenhum novo (ajustes pontuais se algo falhar).

- [ ] **Step 1: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Lint**

Run: `cd mobile && npm run lint`
Expected: sem erros.

- [ ] **Step 3: Suite completa**

Run: `cd mobile && npx jest`
Expected: todos os testes passam.

- [ ] **Step 4: Spike de campo — scheme de retorno**

Rode o app num dispositivo/emulador, toque em "Vincular Moodle", complete o login no `cafe.ufba.br` e observe a URL de retorno:
- Retornou `ufba-app://token=...` → nada a fazer.
- Retornou `moodlemobile://token=...` → o site força `forcedurlscheme`. Adicione `moodlemobile` aos schemes em `mobile/app.json`, rode `npx expo prebuild` (regenera `android/`, que é gitignored — ver gotcha do projeto), ajuste `MOODLE_RETURN_SCHEME`/`openAuthSessionAsync` e re-teste.

- [ ] **Step 5: Spike de campo — `get_site_info` responde**

Após o primeiro login, confirme que `getSiteInfo(session)` resolve com um `userId` válido (o token capturado é utilizável). Isso valida que o serviço `moodle_mobile_app` está de fato disponível para a conta. (Quais funções de conteúdo o site expõe é assunto do spec da página de turma virtual, não deste.)

- [ ] **Step 6: Commit (se houver ajustes)**

```bash
git add -A
git commit -m "chore(mobile): ajustes finais da integração Moodle após spikes de campo"
```
