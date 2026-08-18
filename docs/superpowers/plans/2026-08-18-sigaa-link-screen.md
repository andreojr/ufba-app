# SIGAA Credential Link Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile screen where a signed-in user enters their SIGAA login/senha, opts in or out of cloud persistence, and — for users who previously opted in — restores that credential automatically on a new device.

**Architecture:** A new `sigaa-link.tsx` screen sits between Google sign-in and the app's tabs, gated by a new `SigaaLinkProvider`/`useSigaaLink()` context that mirrors the existing `AuthProvider`/`useAuth()` pattern. The provider checks local `expo-secure-store` first, falls back to a new `GET /sigaa/link` backend endpoint (which decrypts a cloud-saved credential through the existing audit-logged vault), and always caches the result locally afterward. `POST /sigaa/link` (already implemented) handles validation and optional cloud persistence.

**Tech Stack:** NestJS + Prisma (backend, already in place), Expo Router + HeroUI Native + `expo-secure-store` (mobile), Jest + `@testing-library/react-native` / Jest (`.spec.ts`) for tests on both sides.

**Spec:** [docs/superpowers/specs/2026-08-18-sigaa-link-design.md](../specs/2026-08-18-sigaa-link-design.md)

## Global Constraints

- Default the cloud-save checkbox to **unchecked** (privacy-preserving default) — from the spec's "Security considerations" section.
- The SIGAA password transits to the backend on every `/sigaa/link` call regardless of the checkbox; the checkbox controls persistence only, never transmission — do not build any client-side-only bypass of `/sigaa/link`.
- The mobile app **always** caches the credential in `expo-secure-store` after a successful link, independent of the cloud checkbox — this is a locked decision from brainstorming, not a task-level choice.
- No new endpoint is added for fetching schedule/grades using a stored credential — `GET /schedule` keeps taking credentials in its request body (out of scope, per spec).
- Field names are `login` and `senha` (matching the existing `SigaaCredentialsDto`) — do not rename to `cpf`/`matricula`/`password`.

---

## Task 1: Backend — `SigaaLinkService.getLinkedCredentials`

**Files:**
- Modify: `backend/src/sigaa-engine/sigaa-link.service.ts`
- Test: `backend/src/sigaa-engine/sigaa-link.service.spec.ts`

**Interfaces:**
- Consumes: existing `SigaaLinkRepository.findByUserId(userId): Promise<SigaaLinkRecord | null>`, existing `CredentialVault.decrypt(encrypted: EncryptedCredential, context: DecryptionAuditContext): Promise<string>`.
- Produces: `SigaaLinkService.getLinkedCredentials(userId: string): Promise<{ linked: false } | { linked: true; login: string; senha: string }>` — consumed by Task 2's controller.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `backend/src/sigaa-engine/sigaa-link.service.spec.ts` (keep the existing `describe('SigaaLinkService.link', ...)` block as-is above it):

```ts
describe('SigaaLinkService.getLinkedCredentials', () => {
  it('returns linked: false when no record exists for the user', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue(null);
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      fakeVault() as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).resolves.toEqual({
      linked: false,
    });
  });

  it('decrypts and returns the stored credential when a record exists', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      sigaaLogin: 'joao',
      encryptedSenha: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      linkedAt: new Date('2026-01-01'),
    });
    const vault = fakeVault();
    vault.decrypt.mockResolvedValue('segredo');
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).resolves.toEqual({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
    expect(vault.decrypt).toHaveBeenCalledWith(
      { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      { userId: 'user-1', reason: 'mobile-restore' },
    );
  });

  it('propagates a decryption failure without returning partial data', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      sigaaLogin: 'joao',
      encryptedSenha: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      linkedAt: new Date('2026-01-01'),
    });
    const vault = fakeVault();
    vault.decrypt.mockRejectedValue(new Error('bad key'));
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).rejects.toThrow(
      'bad key',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest sigaa-link.service.spec.ts`
Expected: FAIL — `getLinkedCredentials is not a function`.

- [ ] **Step 3: Implement `getLinkedCredentials`**

In `backend/src/sigaa-engine/sigaa-link.service.ts`, add this method to the `SigaaLinkService` class, right after the existing `link` method:

```ts
  /**
   * Restores a previously cloud-saved credential (e.g. after a reinstall or
   * on a new device). Decryption goes through the same audit-logged vault
   * path as every other decrypt.
   */
  async getLinkedCredentials(
    userId: string,
  ): Promise<{ linked: false } | { linked: true; login: string; senha: string }> {
    const record = await this.repository.findByUserId(userId);
    if (!record) {
      return { linked: false };
    }

    const senha = await this.vault.decrypt(record.encryptedSenha, {
      userId,
      reason: 'mobile-restore',
    });

    return { linked: true, login: record.sigaaLogin, senha };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest sigaa-link.service.spec.ts`
Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/sigaa-link.service.ts backend/src/sigaa-engine/sigaa-link.service.spec.ts
git commit -m "feat(backend): add SigaaLinkService.getLinkedCredentials

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `GET /sigaa/link` endpoint

**Files:**
- Modify: `backend/src/sigaa-engine/sigaa.controller.ts`
- Test: `backend/src/sigaa-engine/sigaa.controller.spec.ts`

**Interfaces:**
- Consumes: `SigaaLinkService.getLinkedCredentials(userId: string)` from Task 1.
- Produces: `GET sigaa/link` HTTP route returning `{ linked: false } | { linked: true; login: string; senha: string }`, guarded by the existing class-level `@UseGuards(JwtAuthGuard)` — consumed by the mobile `getSigaaLink()` API call in Task 4.

- [ ] **Step 1: Write the failing tests**

In `backend/src/sigaa-engine/sigaa.controller.spec.ts`, update `fakeLinkService()` to include the new method, and add two new tests. Replace the existing `fakeLinkService` function:

```ts
function fakeLinkService() {
  return {
    link: jest.fn().mockResolvedValue(undefined),
    getLinkedCredentials: jest.fn().mockResolvedValue({ linked: false }),
  };
}
```

Then add these two tests at the end of the `describe('SigaaController', ...)` block, after the existing `'GET grades throws...'` test:

```ts
  it('GET sigaa/link returns linked: false when the service reports no link', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
    );

    await expect(controller.getLink(user)).resolves.toEqual({
      linked: false,
    });
    expect(linkService.getLinkedCredentials).toHaveBeenCalledWith('user-1');
  });

  it('GET sigaa/link returns the restored credential when the service finds one', async () => {
    const linkService = fakeLinkService();
    linkService.getLinkedCredentials.mockResolvedValue({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
    );

    await expect(controller.getLink(user)).resolves.toEqual({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest sigaa.controller.spec.ts`
Expected: FAIL — `controller.getLink is not a function`.

- [ ] **Step 3: Implement the controller method**

In `backend/src/sigaa-engine/sigaa.controller.ts`, add this method to `SigaaController`, right after the existing `link` method (before the `schedule` method):

```ts
  @Get('sigaa/link')
  async getLink(
    @CurrentUser() user: RequestUser,
  ): Promise<{ linked: false } | { linked: true; login: string; senha: string }> {
    return this.linkService.getLinkedCredentials(user.userId);
  }
```

Note: `Get` and `CurrentUser`/`RequestUser` are already imported at the top of this file — no new imports needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest sigaa.controller.spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && npm test`
Expected: PASS (no regressions in other suites).

- [ ] **Step 6: Commit**

```bash
git add backend/src/sigaa-engine/sigaa.controller.ts backend/src/sigaa-engine/sigaa.controller.spec.ts
git commit -m "feat(backend): add GET /sigaa/link to restore a cloud-saved credential

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Mobile — `SigaaCredentials` type + `sigaa-storage.ts`

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Create: `mobile/src/lib/sigaa-storage.ts`
- Test: `mobile/src/lib/sigaa-storage.test.ts`

**Interfaces:**
- Produces: `SigaaCredentials { login: string; senha: string }` type, and `getSigaaCredentials(): Promise<SigaaCredentials | null>` / `saveSigaaCredentials(credentials: SigaaCredentials): Promise<void>` / `clearSigaaCredentials(): Promise<void>` — consumed by Task 5's `SigaaLinkProvider`.

- [ ] **Step 1: Add the `SigaaCredentials` type**

Add this to `mobile/src/lib/types.ts`, after the existing `Session` interface:

```ts
export interface SigaaCredentials {
  login: string;
  senha: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `mobile/src/lib/sigaa-storage.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import {
  clearSigaaCredentials,
  getSigaaCredentials,
  saveSigaaCredentials,
} from "./sigaa-storage";
import type { SigaaCredentials } from "./types";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

const CREDENTIALS: SigaaCredentials = { login: "joao", senha: "segredo" };

describe("sigaa-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when nothing is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns the parsed credentials when stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(CREDENTIALS));

    await expect(getSigaaCredentials()).resolves.toEqual(CREDENTIALS);
  });

  it("returns null when the stored value is corrupted JSON", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("not-json");

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns null when SecureStore.getItemAsync rejects", async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error("Keystore decryption failed"));

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("returns null when the stored value is valid JSON but not credentials-shaped", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("{}");

    await expect(getSigaaCredentials()).resolves.toBeNull();
  });

  it("saves the credentials as JSON under the sigaa key", async () => {
    await saveSigaaCredentials(CREDENTIALS);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.sigaa",
      JSON.stringify(CREDENTIALS),
    );
  });

  it("clears the stored credentials", async () => {
    await clearSigaaCredentials();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("gradline.sigaa");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd mobile && npx jest sigaa-storage.test.ts`
Expected: FAIL — cannot find module `./sigaa-storage`.

- [ ] **Step 4: Implement `sigaa-storage.ts`**

Create `mobile/src/lib/sigaa-storage.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import type { SigaaCredentials } from "./types";

const SIGAA_KEY = "gradline.sigaa";

function isSigaaCredentials(value: unknown): value is SigaaCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SigaaCredentials).login === "string" &&
    typeof (value as SigaaCredentials).senha === "string"
  );
}

export async function getSigaaCredentials(): Promise<SigaaCredentials | null> {
  try {
    const raw = await SecureStore.getItemAsync(SIGAA_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return isSigaaCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSigaaCredentials(credentials: SigaaCredentials): Promise<void> {
  await SecureStore.setItemAsync(SIGAA_KEY, JSON.stringify(credentials));
}

export async function clearSigaaCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(SIGAA_KEY);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest sigaa-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/sigaa-storage.ts mobile/src/lib/sigaa-storage.test.ts
git commit -m "feat(mobile): add SigaaCredentials type and secure-store-backed storage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Mobile — `api.ts` additions (`postSigaaLink`, `getSigaaLink`)

**Files:**
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `SigaaCredentials` type from Task 3.
- Produces: `postSigaaLink(accessToken: string, credentials: SigaaCredentials, rememberPassword: boolean): Promise<void>` and `getSigaaLink(accessToken: string): Promise<SigaaLinkStatus>` where `SigaaLinkStatus = { linked: false } | ({ linked: true } & SigaaCredentials)` — both consumed by Task 5's `SigaaLinkProvider`.

This task refactors `api.ts` to extract a shared `request()` helper (DRY — a third near-identical fetch/timeout/error block is one too many to keep copy-pasting). The existing `postGoogleLogin` behavior and its existing tests are preserved exactly — verify this in Step 4.

- [ ] **Step 1: Write the failing tests**

Add these two `describe` blocks to the end of `mobile/src/lib/api.test.ts` (keep the existing `describe('postGoogleLogin', ...)` block unchanged above them):

```ts
describe("postSigaaLink", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the credentials with the bearer token and rememberPassword flag", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: true }),
    });

    await postSigaaLink("access-token", { login: "joao", senha: "segredo" }, true);

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/sigaa/link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
      body: JSON.stringify({ login: "joao", senha: "segredo", rememberPassword: true }),
      signal: expect.any(AbortSignal),
    });
  });

  it("throws ApiError when the backend rejects the credentials", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(
      postSigaaLink("access-token", { login: "joao", senha: "wrong" }, false),
    ).rejects.toThrow(ApiError);
  });
});

describe("getSigaaLink", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("returns linked: false when the backend reports no stored credential", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: false }),
    });

    await expect(getSigaaLink("access-token")).resolves.toEqual({ linked: false });

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/sigaa/link", {
      method: "GET",
      headers: { Authorization: "Bearer access-token" },
      body: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it("returns the restored credential when the backend has one stored", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ linked: true, login: "joao", senha: "segredo" }),
    });

    await expect(getSigaaLink("access-token")).resolves.toEqual({
      linked: true,
      login: "joao",
      senha: "segredo",
    });
  });

  it("throws ApiError on a non-2xx response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(getSigaaLink("access-token")).rejects.toThrow(ApiError);
  });
});
```

Update the top import line of `mobile/src/lib/api.test.ts` from:

```ts
import { ApiError, postGoogleLogin } from "./api";
```

to:

```ts
import { ApiError, getSigaaLink, postGoogleLogin, postSigaaLink } from "./api";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest api.test.ts`
Expected: FAIL — `postSigaaLink`/`getSigaaLink` are not exported.

- [ ] **Step 3: Implement the `request()` helper and the two new functions**

Replace the full contents of `mobile/src/lib/api.ts` with:

```ts
import type { SigaaCredentials, Session } from "./types";

export class ApiError extends Error {}

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
    throw new ApiError(`Request to ${path} failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function postGoogleLogin(idToken: string): Promise<Session> {
  return request<Session>("/auth/google", { method: "POST", body: { idToken } });
}

export async function postSigaaLink(
  accessToken: string,
  credentials: SigaaCredentials,
  rememberPassword: boolean
): Promise<void> {
  await request<{ linked: true }>("/sigaa/link", {
    method: "POST",
    accessToken,
    body: { ...credentials, rememberPassword },
  });
}

export type SigaaLinkStatus = { linked: false } | ({ linked: true } & SigaaCredentials);

export async function getSigaaLink(accessToken: string): Promise<SigaaLinkStatus> {
  return request<SigaaLinkStatus>("/sigaa/link", { method: "GET", accessToken });
}
```

- [ ] **Step 4: Run all tests in the file to verify nothing broke**

Run: `cd mobile && npx jest api.test.ts`
Expected: PASS — including the pre-existing `postGoogleLogin` tests unchanged (the refactored `request()` helper produces byte-identical `fetch` calls for that case: same URL, same `{ "Content-Type": "application/json" }` header object, same JSON body, same `AbortSignal`).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): add postSigaaLink/getSigaaLink API calls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Mobile — `SigaaLinkProvider` / `useSigaaLink()`

**Files:**
- Create: `mobile/src/lib/sigaa-link-context.tsx`
- Test: `mobile/src/lib/sigaa-link-context.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `mobile/src/lib/auth-context.tsx` (existing), `getSigaaLink`/`postSigaaLink` from Task 4, `getSigaaCredentials`/`saveSigaaCredentials` from Task 3.
- Produces: `SigaaLinkProvider` component and `useSigaaLink(): { status: "loading" | "linked" | "unlinked"; link(login: string, senha: string, rememberPassword: boolean): Promise<void> }` — consumed by Task 6's screen and Task 7's root layout.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/lib/sigaa-link-context.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import * as api from "./api";
import { useAuth } from "./auth-context";
import { SigaaLinkProvider, useSigaaLink } from "./sigaa-link-context";
import * as sigaaStorage from "./sigaa-storage";

jest.mock("./api");
jest.mock("./auth-context");
jest.mock("./sigaa-storage");

const mockedApi = jest.mocked(api);
const mockedUseAuth = jest.mocked(useAuth);
const mockedSigaaStorage = jest.mocked(sigaaStorage);

const CREDENTIALS = { login: "joao", senha: "segredo" };

function wrapper({ children }: PropsWithChildren) {
  return <SigaaLinkProvider>{children}</SigaaLinkProvider>;
}

describe("SigaaLinkProvider / useSigaaLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stays loading while the user is signed out", async () => {
    mockedUseAuth.mockReturnValue({ status: "signedOut", signIn: jest.fn(), signOut: jest.fn() });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    expect(result.current.status).toBe("loading");
    expect(mockedSigaaStorage.getSigaaCredentials).not.toHaveBeenCalled();
  });

  it("resolves to linked without a network call when a local credential exists", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(CREDENTIALS);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(mockedApi.getSigaaLink).not.toHaveBeenCalled();
  });

  it("falls back to GET /sigaa/link and resolves to unlinked when nothing is stored anywhere", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    expect(mockedApi.getSigaaLink).toHaveBeenCalledWith("token");
    expect(mockedSigaaStorage.saveSigaaCredentials).not.toHaveBeenCalled();
  });

  it("restores a cloud-saved credential locally and resolves to linked", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: true, ...CREDENTIALS });

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("linked"));
    expect(mockedSigaaStorage.saveSigaaCredentials).toHaveBeenCalledWith(CREDENTIALS);
  });

  it("resolves to unlinked when the restore network call fails", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockRejectedValue(new Error("network down"));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unlinked"));
    consoleWarn.mockRestore();
  });

  it("link() posts the credentials, caches them locally, and sets status to linked", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("joao", "segredo", true);
    });

    expect(mockedApi.postSigaaLink).toHaveBeenCalledWith("token", CREDENTIALS, true);
    expect(mockedSigaaStorage.saveSigaaCredentials).toHaveBeenCalledWith(CREDENTIALS);
    expect(result.current.status).toBe("linked");
  });

  it("link() still resolves to linked when the backend succeeds but the local cache write fails", async () => {
    mockedUseAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token",
      user: { googleId: "1", email: "a@b.com", name: "A" },
      signIn: jest.fn(),
      signOut: jest.fn(),
    });
    mockedSigaaStorage.getSigaaCredentials.mockResolvedValue(null);
    mockedApi.getSigaaLink.mockResolvedValue({ linked: false });
    mockedApi.postSigaaLink.mockResolvedValue(undefined);
    mockedSigaaStorage.saveSigaaCredentials.mockRejectedValue(new Error("keystore full"));
    const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useSigaaLink(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unlinked"));

    await act(async () => {
      await result.current.link("joao", "segredo", true);
    });

    expect(result.current.status).toBe("linked");
    consoleWarn.mockRestore();
  });

  it("throws when useSigaaLink is called outside SigaaLinkProvider", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(renderHook(() => useSigaaLink())).rejects.toThrow(
      "useSigaaLink must be used within a SigaaLinkProvider"
    );

    consoleError.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest sigaa-link-context.test.tsx`
Expected: FAIL — cannot find module `./sigaa-link-context`.

- [ ] **Step 3: Implement `sigaa-link-context.tsx`**

Create `mobile/src/lib/sigaa-link-context.tsx`:

```tsx
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

import { getSigaaLink, postSigaaLink } from "./api";
import { useAuth } from "./auth-context";
import { getSigaaCredentials, saveSigaaCredentials } from "./sigaa-storage";

type SigaaLinkState = { status: "loading" | "linked" | "unlinked" };

type SigaaLinkContextValue = SigaaLinkState & {
  link: (login: string, senha: string, rememberPassword: boolean) => Promise<void>;
};

const SigaaLinkContext = createContext<SigaaLinkContextValue | undefined>(undefined);

export function SigaaLinkProvider({ children }: PropsWithChildren): JSX.Element {
  const auth = useAuth();
  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;
  const [state, setState] = useState<SigaaLinkState>({ status: "loading" });

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function restore(token: string): Promise<void> {
      const local = await getSigaaCredentials();
      if (local) {
        if (isMounted) setState({ status: "linked" });
        return;
      }

      try {
        const remote = await getSigaaLink(token);
        if (remote.linked) {
          await saveSigaaCredentials({ login: remote.login, senha: remote.senha });
          if (isMounted) setState({ status: "linked" });
        } else if (isMounted) {
          setState({ status: "unlinked" });
        }
      } catch (error) {
        console.warn("Failed to restore SIGAA link", error);
        if (isMounted) setState({ status: "unlinked" });
      }
    }

    restore(accessToken);

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  const link = useCallback(
    async (login: string, senha: string, rememberPassword: boolean) => {
      if (!accessToken) {
        throw new Error("Cannot link SIGAA credentials while signed out");
      }
      await postSigaaLink(accessToken, { login, senha }, rememberPassword);

      try {
        await saveSigaaCredentials({ login, senha });
      } catch (error) {
        // Backend already validated/persisted per rememberPassword; a local
        // caching failure just means this device may re-prompt later.
        console.warn("Failed to cache SIGAA credentials locally", error);
      }

      setState({ status: "linked" });
    },
    [accessToken]
  );

  const value = useMemo<SigaaLinkContextValue>(() => ({ ...state, link }), [state, link]);

  return <SigaaLinkContext.Provider value={value}>{children}</SigaaLinkContext.Provider>;
}

export function useSigaaLink(): SigaaLinkContextValue {
  const context = useContext(SigaaLinkContext);
  if (!context) {
    throw new Error("useSigaaLink must be used within a SigaaLinkProvider");
  }
  return context;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest sigaa-link-context.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/sigaa-link-context.tsx mobile/src/lib/sigaa-link-context.test.tsx
git commit -m "feat(mobile): add SigaaLinkProvider/useSigaaLink with local-first restore

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Mobile — `sigaa-link.tsx` screen

**Files:**
- Create: `mobile/src/app/sigaa-link.tsx`
- Test: `mobile/src/__tests__/sigaa-link.test.tsx`

**Interfaces:**
- Consumes: `useSigaaLink()` from Task 5.
- Produces: default-exported `SigaaLinkScreen` component, registered as the `sigaa-link` route by expo-router's file-based routing — consumed by Task 7's root layout guard.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/__tests__/sigaa-link.test.tsx`:

```tsx
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { useSigaaLink } from "@/lib/sigaa-link-context";

import SigaaLinkScreen from "@/app/sigaa-link";

jest.mock("@/lib/sigaa-link-context");

const mockToastShow = jest.fn();

jest.mock("heroui-native", () => {
  const { Text, TextInput, TouchableOpacity } = jest.requireActual("react-native");

  return {
    useToast: () => ({ toast: { show: mockToastShow } }),
    Button: ({ children, onPress, isDisabled }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <Text>loading</Text>,
    Checkbox: ({ isSelected, onSelectedChange }: any) => (
      <TouchableOpacity
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        onPress={() => onSelectedChange(!isSelected)}
      />
    ),
    TextField: ({ children }: any) => <>{children}</>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    Input: ({ value, onChangeText, placeholder, secureTextEntry }: any) => (
      <TextInput
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
      />
    ),
  };
});

const mockedUseSigaaLink = jest.mocked(useSigaaLink);

describe("SigaaLinkScreen", () => {
  const link = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseSigaaLink.mockReturnValue({ status: "unlinked", link });
  });

  it("does not call link when fields are empty", async () => {
    const { getByRole } = render(<SigaaLinkScreen />);

    await act(async () => {
      fireEvent.press(getByRole("button"));
    });

    expect(link).not.toHaveBeenCalled();
  });

  it("calls link with rememberPassword=false when the checkbox is left unchecked", async () => {
    link.mockResolvedValue(undefined);
    const { getByRole, getByPlaceholderText } = render(<SigaaLinkScreen />);

    fireEvent.changeText(getByPlaceholderText("Sua matrícula ou login"), "joao");
    fireEvent.changeText(getByPlaceholderText("Sua senha"), "segredo");

    await act(async () => {
      fireEvent.press(getByRole("button"));
    });

    expect(link).toHaveBeenCalledWith("joao", "segredo", false);
  });

  it("calls link with rememberPassword=true when the checkbox is checked", async () => {
    link.mockResolvedValue(undefined);
    const { getByRole, getByPlaceholderText } = render(<SigaaLinkScreen />);

    fireEvent.changeText(getByPlaceholderText("Sua matrícula ou login"), "joao");
    fireEvent.changeText(getByPlaceholderText("Sua senha"), "segredo");
    fireEvent.press(getByRole("checkbox"));

    await act(async () => {
      fireEvent.press(getByRole("button"));
    });

    expect(link).toHaveBeenCalledWith("joao", "segredo", true);
  });

  it("shows a toast when link fails", async () => {
    link.mockRejectedValue(new Error("invalid credentials"));
    const { getByRole, getByPlaceholderText } = render(<SigaaLinkScreen />);

    fireEvent.changeText(getByPlaceholderText("Sua matrícula ou login"), "joao");
    fireEvent.changeText(getByPlaceholderText("Sua senha"), "segredo");

    await act(async () => {
      fireEvent.press(getByRole("button"));
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest sigaa-link.test.tsx`
Expected: FAIL — cannot find module `@/app/sigaa-link`.

- [ ] **Step 3: Implement `sigaa-link.tsx`**

Create `mobile/src/app/sigaa-link.tsx`:

```tsx
import { useState, type JSX } from "react";
import { Text, View } from "react-native";
import { Button, Checkbox, Input, Label, Spinner, TextField, useToast } from "heroui-native";

import { useSigaaLink } from "@/lib/sigaa-link-context";

export default function SigaaLinkScreen(): JSX.Element {
  const { link } = useSigaaLink();
  const { toast } = useToast();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [saveToCloud, setSaveToCloud] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = login.trim().length > 0 && senha.length > 0 && !isSubmitting;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      await link(login.trim(), senha, saveToCloud);
    } catch (error) {
      console.warn("SIGAA link failed", error);
      toast.show("Não foi possível validar seu login do SIGAA. Confira usuário e senha.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-background justify-center gap-6 px-6">
      <TextField isRequired>
        <Label>Usuário do SIGAA</Label>
        <Input
          placeholder="Sua matrícula ou login"
          autoCapitalize="none"
          value={login}
          onChangeText={setLogin}
        />
      </TextField>

      <TextField isRequired>
        <Label>Senha do SIGAA</Label>
        <Input placeholder="Sua senha" secureTextEntry value={senha} onChangeText={setSenha} />
      </TextField>

      <View className="flex-row items-center gap-3">
        <Checkbox isSelected={saveToCloud} onSelectedChange={setSaveToCloud} />
        <Text className="flex-1 text-foreground">
          Guardar minha senha do SIGAA na nuvem, para não precisar digitar de novo em outro
          aparelho.
        </Text>
      </View>

      <Button isDisabled={!canSubmit} isIconOnly={isSubmitting} onPress={handleSubmit}>
        {isSubmitting ? <Spinner /> : "Continuar"}
      </Button>
    </View>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest sigaa-link.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/sigaa-link.tsx mobile/src/__tests__/sigaa-link.test.tsx
git commit -m "feat(mobile): add SIGAA credential link screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Mobile — wire `SigaaLinkProvider` into the root navigator

**Files:**
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: `SigaaLinkProvider`/`useSigaaLink()` from Task 5, `sigaa-link` route from Task 6.
- Produces: nothing new — this task only changes routing gates. No test file exists for `_layout.tsx` today (it wasn't added when the `login`/`(tabs)` gate was built either); this task follows that existing precedent and is verified manually in Step 2.

- [ ] **Step 1: Update `_layout.tsx`**

Replace the full contents of `mobile/src/app/_layout.tsx` with:

```tsx
import { useEffect, type JSX } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { configureGoogleSignin } from "@/lib/google-signin";
import { SigaaLinkProvider, useSigaaLink } from "@/lib/sigaa-link-context";

import "../global.css";

function RootNavigator(): JSX.Element | null {
  const auth = useAuth();
  const sigaaLink = useSigaaLink();

  if (auth.status === "loading") {
    return null;
  }

  if (auth.status === "signedIn" && sigaaLink.status === "loading") {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={auth.status === "signedIn" && sigaaLink.status === "linked"}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === "signedIn" && sigaaLink.status === "unlinked"}>
        <Stack.Screen name="sigaa-link" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout(): JSX.Element {
  useEffect(() => {
    configureGoogleSignin();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AuthProvider>
          <SigaaLinkProvider>
            <RootNavigator />
          </SigaaLinkProvider>
        </AuthProvider>
        <StatusBar style="auto" />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Run the full mobile test suite**

Run: `cd mobile && npm test`
Expected: PASS — every suite from Tasks 3–6 plus the pre-existing `login.test.tsx`/`auth-context.test.tsx`/`api.test.ts`/`session-storage.test.ts`/`google-signin.test.ts` all green, confirming this routing change didn't break sign-in or sign-out flows.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/app/_layout.tsx
git commit -m "feat(mobile): gate (tabs) behind SIGAA link, route to sigaa-link when unlinked

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 2: Run the full mobile suite**

Run: `cd mobile && npm test`
Expected: PASS.

- [ ] **Step 3: Lint both packages**

Run: `cd backend && npm run lint` and `cd mobile && npm run lint` (check `package.json` in each for the exact lint script name if this fails — both projects have `eslint.config.*` per the repo listing).
Expected: no new lint errors introduced by this feature's files.

- [ ] **Step 4: Manually confirm the spec's data-flow scenarios**

Using the `run` skill (or manually via `expo start` + a dev client build), confirm:
- Signing in with Google for the first time with no `SigaaLink` on the backend lands on `sigaa-link.tsx`.
- Submitting valid SIGAA credentials with the checkbox unchecked navigates to `(tabs)`, and `GET /sigaa/link` (checked via a fresh app reinstall or by clearing local storage) then returns `{ linked: false }`.
- Submitting valid SIGAA credentials with the checkbox checked navigates to `(tabs)`, and clearing only local storage (simulating a reinstall) causes the next launch to skip `sigaa-link.tsx` and restore straight into `(tabs)`.
- Submitting invalid SIGAA credentials shows the toast and stays on `sigaa-link.tsx`.
