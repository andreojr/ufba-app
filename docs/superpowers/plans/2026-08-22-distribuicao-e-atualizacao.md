# Distribuição e atualização do app (fora da loja) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao app um canal de atualização próprio — ele descobre sozinho que existe versão nova, avisa na Home, mostra a versão instalada no Perfil, e baixa e instala o APK sem o usuário sair do app.

**Architecture:** O backend expõe `GET /app/version`, público e alimentado por variáveis de ambiente do Railway — apontar essas variáveis é o ato de "lançar". O mobile compara essa resposta com a própria `expo.version`, decide em lógica pura, e a UI só consome o resultado. A instalação usa a API moderna do `expo-file-system` (download pro cache + `File#contentUri`) e `expo-intent-launcher` (intent de instalação). Nada de OTA — ver a spec.

**Tech Stack:** NestJS + `@nestjs/config` (backend); Expo SDK 57, React Native 0.86, expo-constants, expo-secure-store, expo-file-system 57, expo-intent-launcher, heroui-native, Jest + jest-expo + RTL v14 (mobile).

**Spec:** [`docs/superpowers/specs/2026-08-22-distribuicao-e-atualizacao-design.md`](../specs/2026-08-22-distribuicao-e-atualizacao-design.md)

## Global Constraints

- **Falha é silêncio.** Qualquer erro na checagem de atualização (rede, timeout, 404, backend fora) resulta em **nenhum aviso renderizado**. A checagem nunca bloqueia render nem mostra erro ao usuário.
- **Idioma:** copy de interface em português do Brasil; **comentários e nomes de teste em inglês**, como o resto do código. Docs e specs em português.
- **Chaves de SecureStore** usam o prefixo `gradline.`, como `gradline.theme-preference`.
- **Mensagens de exceção do backend em inglês**, como `No cached profile for siape ...`.
- **Pré-requisito: SDK 57.** Este plano assume o upgrade feito (branch `upgrade-sdk-57`). Verificar antes de começar que `mobile/package.json` traz `expo` na faixa `^57`.
- **`expo-file-system`: usar só a API moderna, nunca o subpath `legacy`.** O legacy está depreciado, e desde a 56 a API moderna cobre tudo que esta entrega precisa. Confirmado na 57.0.5 instalada: `File.downloadFileAsync(url, destino, { headers, idempotent, onProgress, signal })`, `DownloadProgress { bytesWritten, totalBytes }` (com `totalBytes: -1` quando não há `Content-Length`), `File#contentUri` (Android, herdado de `FileSystemFile`), `file.delete()` e `Paths.cache`.
- **`app.json` é a fonte da versão.** `expo.version` (semver) e `expo.android.versionCode` (inteiro) sobem **sempre juntos**.
- **Nunca linkar artefato do EAS Build direto** — aquelas URLs expiram. O APK vai pro GitHub Releases.
- **Toda task termina com commit.** Rodar `npm run typecheck` e `npm test` (no diretório do lado alterado) antes de cada commit.

---

## File Structure

**Backend (`backend/src/app-release/`) — novo módulo**
- `app-release.service.ts` — lê as variáveis de ambiente e devolve o release ou `null`.
- `app-release.service.spec.ts`
- `app-release.controller.ts` — `GET /app/version`, público.
- `app-release.controller.spec.ts`
- `app-release.module.ts`
- Modifica: `backend/src/app.module.ts` (registra o módulo).

**Mobile**
- `mobile/src/lib/app-version.ts` + `.test.ts` — comparação semver pura.
- `mobile/src/lib/api.ts` (modifica) — `getAppVersion()`.
- `mobile/src/lib/types.ts` (modifica) — `AppRelease`.
- `mobile/src/lib/app-update-storage.ts` + `.test.ts` — dispensa por versão e timestamp da última checagem.
- `mobile/src/lib/app-update-install.ts` + `.test.ts` — download, content URI, intent, limpeza.
- `mobile/src/lib/use-app-update.ts` + `.test.tsx` — hook que orquestra checagem e instalação.
- `mobile/src/components/UpdateCard.tsx` — o card da Home.
- `mobile/src/screens/HomeTab.tsx` (modifica) — monta o card.
- `mobile/src/app/(tabs)/ajustes.tsx` (modifica) — linha de versão.
- `mobile/app.json` (modifica) — `versionCode`, permissão, plugin.

**Landing (`landing/`) — novo diretório**
- `landing/index.html`, `landing/style.css`, `landing/README.md`.

**Docs**
- `docs/reference/release.md` — checklist de release e custódia da keystore.

---

### Task 1: Backend — endpoint `GET /app/version`

**Files:**
- Create: `backend/src/app-release/app-release.service.ts`
- Create: `backend/src/app-release/app-release.service.spec.ts`
- Create: `backend/src/app-release/app-release.controller.ts`
- Create: `backend/src/app-release/app-release.controller.spec.ts`
- Create: `backend/src/app-release/app-release.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `AppRelease { latestVersion: string; versionCode: number; downloadUrl: string; releaseNotes: string; publishedAt: string }`, exportada de `app-release.service.ts`. A Task 3 replica essa forma no mobile.

- [ ] **Step 1: Write the failing service test**

Create `backend/src/app-release/app-release.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { AppReleaseService } from './app-release.service';

function configFake(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const COMPLETE = {
  APP_LATEST_VERSION: '1.1.0',
  APP_LATEST_VERSION_CODE: '3',
  APP_DOWNLOAD_URL: 'https://example.com/gradline-1.1.0.apk',
  APP_RELEASE_NOTES: 'Optativas na Trajetória.',
  APP_PUBLISHED_AT: '2026-09-01T12:00:00Z',
};

describe('AppReleaseService', () => {
  it('reads the published release off the environment', () => {
    const service = new AppReleaseService(configFake(COMPLETE));

    expect(service.release()).toEqual({
      latestVersion: '1.1.0',
      versionCode: 3,
      downloadUrl: 'https://example.com/gradline-1.1.0.apk',
      releaseNotes: 'Optativas na Trajetória.',
      publishedAt: '2026-09-01T12:00:00Z',
    });
  });

  it('reports nothing published when a required variable is missing', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_DOWNLOAD_URL: undefined }),
    );

    expect(service.release()).toBeNull();
  });

  it('reports nothing published when the version code is not an integer', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_LATEST_VERSION_CODE: 'three' }),
    );

    expect(service.release()).toBeNull();
  });

  it('treats absent release notes as empty rather than unpublished', () => {
    const service = new AppReleaseService(
      configFake({ ...COMPLETE, APP_RELEASE_NOTES: undefined }),
    );

    expect(service.release()?.releaseNotes).toBe('');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npx jest src/app-release/app-release.service.spec.ts`
Expected: FAIL — `Cannot find module './app-release.service'`.

- [ ] **Step 3: Implement the service**

Create `backend/src/app-release/app-release.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The currently published Android build, as the mobile client sees it. */
export interface AppRelease {
  /** Semver, compared against the installed app's own `expo.version`. */
  latestVersion: string;
  /** Android's monotonic build number — the system refuses to install a lower one. */
  versionCode: number;
  /** Stable GitHub Releases asset URL. EAS Build artifact URLs expire; never use those. */
  downloadUrl: string;
  releaseNotes: string;
  /** ISO 8601. */
  publishedAt: string;
}

/**
 * Reads the release off environment variables rather than a table: publishing
 * is `railway variables --set ...`, with no migration and no admin screen. The
 * response shape is what would outlive a move to the database, so the client
 * never has to change if that day comes.
 */
@Injectable()
export class AppReleaseService {
  constructor(private readonly config: ConfigService) {}

  /** Null when nothing is published yet, or the configuration is incomplete. */
  release(): AppRelease | null {
    const latestVersion = this.config.get<string>('APP_LATEST_VERSION');
    const rawVersionCode = this.config.get<string>('APP_LATEST_VERSION_CODE');
    const downloadUrl = this.config.get<string>('APP_DOWNLOAD_URL');
    const publishedAt = this.config.get<string>('APP_PUBLISHED_AT');

    if (!latestVersion || !rawVersionCode || !downloadUrl || !publishedAt) {
      return null;
    }

    const versionCode = Number.parseInt(rawVersionCode, 10);
    if (!Number.isInteger(versionCode)) {
      return null;
    }

    return {
      latestVersion,
      versionCode,
      downloadUrl,
      // A release with no notes is still a release — only the identifying
      // fields above are required.
      releaseNotes: this.config.get<string>('APP_RELEASE_NOTES') ?? '',
      publishedAt,
    };
  }
}
```

- [ ] **Step 4: Run the service test — it passes**

Run: `cd backend && npx jest src/app-release/app-release.service.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing controller test**

Create `backend/src/app-release/app-release.controller.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService, type AppRelease } from './app-release.service';

const RELEASE: AppRelease = {
  latestVersion: '1.1.0',
  versionCode: 3,
  downloadUrl: 'https://example.com/gradline-1.1.0.apk',
  releaseNotes: 'Optativas na Trajetória.',
  publishedAt: '2026-09-01T12:00:00Z',
};

function serviceFake(release: AppRelease | null): AppReleaseService {
  return { release: () => release } as unknown as AppReleaseService;
}

describe('AppReleaseController', () => {
  it('returns the published release', () => {
    const controller = new AppReleaseController(serviceFake(RELEASE));

    expect(controller.version()).toEqual(RELEASE);
  });

  it('404s when nothing is published instead of returning a half-filled body', () => {
    const controller = new AppReleaseController(serviceFake(null));

    expect(() => controller.version()).toThrow(NotFoundException);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd backend && npx jest src/app-release/app-release.controller.spec.ts`
Expected: FAIL — `Cannot find module './app-release.controller'`.

- [ ] **Step 7: Implement the controller and the module**

Create `backend/src/app-release/app-release.controller.ts`:

```ts
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { AppReleaseService, type AppRelease } from './app-release.service';

/**
 * Deliberately NOT behind JwtAuthGuard: the app checks for updates before the
 * user has signed in, and the payload is the same public information the
 * landing page already serves.
 */
@Controller('app')
export class AppReleaseController {
  constructor(private readonly service: AppReleaseService) {}

  @Get('version')
  version(): AppRelease {
    const release = this.service.release();
    if (!release) {
      throw new NotFoundException('No app release is published');
    }
    return release;
  }
}
```

Create `backend/src/app-release/app-release.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';

/** No AuthModule and no DatabaseModule — this module reads only the environment. */
@Module({
  controllers: [AppReleaseController],
  providers: [AppReleaseService],
})
export class AppReleaseModule {}
```

- [ ] **Step 8: Register the module**

In `backend/src/app.module.ts`, add the import line alongside the others and `AppReleaseModule` to the `imports` array:

```ts
import { AppReleaseModule } from './app-release/app-release.module';
```

- [ ] **Step 9: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: PASS, including the 6 new tests.

- [ ] **Step 10: Commit**

```bash
git add backend/src/app-release backend/src/app.module.ts
git commit -m "feat(backend): expose the published app release at GET /app/version"
```

---

### Task 2: Mobile — comparação de versões

**Files:**
- Create: `mobile/src/lib/app-version.ts`
- Test: `mobile/src/lib/app-version.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `compararVersoes(a: string, b: string): number` e `haAtualizacao(instalada: string, publicada: string): boolean`. Tasks 5 e 9 consomem `haAtualizacao`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/lib/app-version.test.ts`:

```ts
import { compararVersoes, haAtualizacao } from "./app-version";

describe("compararVersoes", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compararVersoes("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compararVersoes("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compararVersoes("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compararVersoes("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compararVersoes("1.2.3", "1.2.3")).toBe(0);
  });

  it("pads missing segments with zero", () => {
    expect(compararVersoes("1.2", "1.2.0")).toBe(0);
    expect(compararVersoes("1.2", "1.2.1")).toBeLessThan(0);
  });
});

describe("haAtualizacao", () => {
  it("is true only when the published version is ahead", () => {
    expect(haAtualizacao("1.0.0", "1.1.0")).toBe(true);
    expect(haAtualizacao("1.1.0", "1.1.0")).toBe(false);
  });

  it("is false when the installed build is ahead of what is published", () => {
    // A local/dev build, or a release whose environment variables were rolled
    // back. Nagging the user to "update" to an older APK would be wrong.
    expect(haAtualizacao("1.2.0", "1.1.0")).toBe(false);
  });

  it("is false when either version is unparseable", () => {
    expect(haAtualizacao("", "1.1.0")).toBe(false);
    expect(haAtualizacao("1.0.0", "banana")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/lib/app-version.test.ts`
Expected: FAIL — `Cannot find module './app-version'`.

- [ ] **Step 3: Implement**

Create `mobile/src/lib/app-version.ts`:

```ts
/**
 * Version comparison for the update check. Kept pure and I/O-free so the whole
 * "is there an update?" decision is testable in isolation — the UI only ever
 * consumes the boolean.
 */

const SEMVER = /^\d+(\.\d+){0,2}$/;

function segmentos(versao: string): number[] | null {
  const limpa = versao.trim();
  if (!SEMVER.test(limpa)) {
    return null;
  }
  const partes = limpa.split(".").map((parte) => Number.parseInt(parte, 10));
  // Pad so "1.2" and "1.2.0" compare equal.
  while (partes.length < 3) {
    partes.push(0);
  }
  return partes;
}

/** -1 / 0 / 1, like a sort comparator. Unparseable versions compare as equal. */
export function compararVersoes(a: string, b: string): number {
  const esquerda = segmentos(a);
  const direita = segmentos(b);
  if (!esquerda || !direita) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (esquerda[i] !== direita[i]) {
      return esquerda[i] < direita[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Only strictly-ahead counts. An installed build *newer* than what is published
 * (a local build, or a rolled-back release) is not an update — and neither is
 * anything we cannot parse, which keeps a malformed environment variable from
 * nagging every user in the field.
 */
export function haAtualizacao(instalada: string, publicada: string): boolean {
  if (!segmentos(instalada) || !segmentos(publicada)) {
    return false;
  }
  return compararVersoes(instalada, publicada) < 0;
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `cd mobile && npx jest src/lib/app-version.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/app-version.ts mobile/src/lib/app-version.test.ts
git commit -m "feat(mobile): add pure semver comparison for the update check"
```

---

### Task 3: Mobile — `getAppVersion()` no cliente de API

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Test: `mobile/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `AppRelease` (de `types.ts`) e `getAppVersion(): Promise<AppRelease>` (de `api.ts`). A Task 5 consome ambos.

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/__tests__/api.test.ts` a new top-level `describe`. Add `getAppVersion` to the existing import list from `"../lib/api"`:

```ts
describe("checking for an app update", () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  const RELEASE = {
    latestVersion: "1.1.0",
    versionCode: 3,
    downloadUrl: "https://example.com/gradline-1.1.0.apk",
    releaseNotes: "Optativas na Trajetória.",
    publishedAt: "2026-09-01T12:00:00Z",
  };

  it("GETs the published release without an Authorization header", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => RELEASE,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getAppVersion()).resolves.toEqual(RELEASE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/app/version");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("rejects with an ApiError when nothing is published", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "No app release is published" }),
    }) as unknown as typeof fetch;

    await expect(getAppVersion()).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/__tests__/api.test.ts -t "app update"`
Expected: FAIL — `getAppVersion is not a function`.

- [ ] **Step 3: Add the type**

In `mobile/src/lib/types.ts`, add:

```ts
/** Mirrors the backend's `AppRelease` (backend/src/app-release/app-release.service.ts). */
export interface AppRelease {
  latestVersion: string;
  versionCode: number;
  downloadUrl: string;
  releaseNotes: string;
  publishedAt: string;
}
```

- [ ] **Step 4: Add the call**

In `mobile/src/lib/api.ts`, next to the other `get*` functions, add `AppRelease` to the existing `import type { ... } from "./types"` list and:

```ts
/**
 * Public on purpose — the app checks for updates before anyone has signed in,
 * so no access token travels here.
 */
export async function getAppVersion(): Promise<AppRelease> {
  return request<AppRelease>("/app/version", { method: "GET" });
}
```

- [ ] **Step 5: Run the tests — they pass**

Run: `cd mobile && npx jest src/__tests__/api.test.ts`
Expected: PASS, including the 2 new tests.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/api.ts mobile/src/lib/types.ts mobile/src/__tests__/api.test.ts
git commit -m "feat(mobile): fetch the published release from GET /app/version"
```

---

### Task 4: Mobile — dispensa por versão e janela de checagem

**Files:**
- Create: `mobile/src/lib/app-update-storage.ts`
- Test: `mobile/src/lib/app-update-storage.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `getVersaoDispensada(): Promise<string | null>`, `dispensarVersao(versao: string): Promise<void>`, `getUltimaChecagem(): Promise<number | null>`, `marcarChecagem(agora: number): Promise<void>`, `INTERVALO_CHECAGEM_MS`. A Task 5 consome todos.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/lib/app-update-storage.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import {
  dispensarVersao,
  getUltimaChecagem,
  getVersaoDispensada,
  marcarChecagem,
} from "./app-update-storage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

describe("app-update-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has no dismissed version by default", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getVersaoDispensada()).resolves.toBeNull();
  });

  it("persists the dismissed version under its own key", async () => {
    await dispensarVersao("1.1.0");

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.update-dismissed",
      "1.1.0",
    );
  });

  it("returns the dismissed version", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("1.1.0");

    await expect(getVersaoDispensada()).resolves.toBe("1.1.0");
  });

  it("reads back the last check as a number", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("1756000000000");

    await expect(getUltimaChecagem()).resolves.toBe(1756000000000);
  });

  it("treats a corrupted timestamp as never checked", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("nao-e-numero");

    await expect(getUltimaChecagem()).resolves.toBeNull();
  });

  it("persists the check timestamp", async () => {
    await marcarChecagem(1756000000000);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "gradline.update-last-check",
      "1756000000000",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/lib/app-update-storage.test.ts`
Expected: FAIL — `Cannot find module './app-update-storage'`.

- [ ] **Step 3: Implement**

Create `mobile/src/lib/app-update-storage.ts`:

```ts
import * as SecureStore from "expo-secure-store";

/**
 * Two small pieces of update state, in the same SecureStore the theme
 * preference uses. Dismissal is stored as the *version* rather than a boolean
 * so it expires on its own: dismissing 1.1.0 says nothing about 1.2.0.
 */

const VERSAO_DISPENSADA_KEY = "gradline.update-dismissed";
const ULTIMA_CHECAGEM_KEY = "gradline.update-last-check";

/** The check runs at most once an hour — an update is never urgent to the minute. */
export const INTERVALO_CHECAGEM_MS = 60 * 60 * 1000;

export async function getVersaoDispensada(): Promise<string | null> {
  return SecureStore.getItemAsync(VERSAO_DISPENSADA_KEY);
}

export async function dispensarVersao(versao: string): Promise<void> {
  await SecureStore.setItemAsync(VERSAO_DISPENSADA_KEY, versao);
}

export async function getUltimaChecagem(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(ULTIMA_CHECAGEM_KEY);
  if (raw === null) {
    return null;
  }
  const instante = Number.parseInt(raw, 10);
  // Corrupted value reads as "never checked" — worst case is one extra request.
  return Number.isFinite(instante) ? instante : null;
}

export async function marcarChecagem(agora: number): Promise<void> {
  await SecureStore.setItemAsync(ULTIMA_CHECAGEM_KEY, String(agora));
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `cd mobile && npx jest src/lib/app-update-storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/app-update-storage.ts mobile/src/lib/app-update-storage.test.ts
git commit -m "feat(mobile): persist update dismissal per version and the check window"
```

---

### Task 5: Mobile — hook `useAppUpdate`

**Files:**
- Create: `mobile/src/lib/use-app-update.ts`
- Test: `mobile/src/lib/use-app-update.test.tsx`

**Interfaces:**
- Consumes: `getAppVersion` (Task 3), `haAtualizacao` (Task 2), `getVersaoDispensada`/`dispensarVersao`/`getUltimaChecagem`/`marcarChecagem`/`INTERVALO_CHECAGEM_MS` (Task 4).
- Produces: `useAppUpdate(): { versaoInstalada: string; release: AppRelease | null; temAtualizacao: boolean; dispensar: () => void }`. Tasks 8 e 9 consomem.

`release` é preenchido sempre que a checagem der certo (mesmo sem atualização — a tela de Perfil precisa dizer "atualizado"). `temAtualizacao` já desconta a dispensa.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/lib/use-app-update.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import type { JSX } from "react";

import { getAppVersion } from "@/lib/api";
import {
  dispensarVersao,
  getUltimaChecagem,
  getVersaoDispensada,
  marcarChecagem,
} from "@/lib/app-update-storage";
import { useAppUpdate } from "@/lib/use-app-update";

jest.mock("@/lib/api", () => ({ getAppVersion: jest.fn() }));
jest.mock("@/lib/app-update-storage", () => ({
  INTERVALO_CHECAGEM_MS: 3_600_000,
  getVersaoDispensada: jest.fn(),
  dispensarVersao: jest.fn().mockResolvedValue(undefined),
  getUltimaChecagem: jest.fn(),
  marcarChecagem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("expo-constants", () => ({ expoConfig: { version: "1.0.0" } }));

const RELEASE = {
  latestVersion: "1.1.0",
  versionCode: 3,
  downloadUrl: "https://example.com/gradline-1.1.0.apk",
  releaseNotes: "Optativas.",
  publishedAt: "2026-09-01T12:00:00Z",
};

function Sonda(): JSX.Element {
  const { temAtualizacao, versaoInstalada } = useAppUpdate();
  return (
    <>
      <Text testID="instalada">{versaoInstalada}</Text>
      <Text testID="tem">{temAtualizacao ? "sim" : "nao"}</Text>
    </>
  );
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getVersaoDispensada).mockResolvedValue(null);
    jest.mocked(getUltimaChecagem).mockResolvedValue(null);
    jest.mocked(getAppVersion).mockResolvedValue(RELEASE);
  });

  it("reports the installed version off the Expo config", async () => {
    render(<Sonda />);

    expect(screen.getByTestId("instalada")).toHaveTextContent("1.0.0");
  });

  it("flags an update when the published version is ahead", async () => {
    render(<Sonda />);

    await waitFor(() => expect(screen.getByTestId("tem")).toHaveTextContent("sim"));
    expect(marcarChecagem).toHaveBeenCalled();
  });

  it("stays quiet when the user already dismissed that exact version", async () => {
    jest.mocked(getVersaoDispensada).mockResolvedValue("1.1.0");

    render(<Sonda />);

    await waitFor(() => expect(getAppVersion).toHaveBeenCalled());
    expect(screen.getByTestId("tem")).toHaveTextContent("nao");
  });

  it("stays quiet — and never throws — when the backend is unreachable", async () => {
    jest.mocked(getAppVersion).mockRejectedValue(new Error("offline"));

    render(<Sonda />);

    await waitFor(() => expect(getAppVersion).toHaveBeenCalled());
    expect(screen.getByTestId("tem")).toHaveTextContent("nao");
  });

  it("skips the request when the last check was inside the window", async () => {
    jest.mocked(getUltimaChecagem).mockResolvedValue(Date.now() - 60_000);

    render(<Sonda />);

    await waitFor(() => expect(getUltimaChecagem).toHaveBeenCalled());
    expect(getAppVersion).not.toHaveBeenCalled();
  });

});
```

Dismissal is covered end-to-end in Task 8, where it is a real user action on the card. The `dispensarVersao` import above is used only by that mock factory.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/lib/use-app-update.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/use-app-update'`.

- [ ] **Step 3: Implement**

Create `mobile/src/lib/use-app-update.ts`:

```ts
import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { getAppVersion } from "./api";
import { haAtualizacao } from "./app-version";
import {
  dispensarVersao,
  getUltimaChecagem,
  getVersaoDispensada,
  INTERVALO_CHECAGEM_MS,
  marcarChecagem,
} from "./app-update-storage";
import type { AppRelease } from "./types";

/**
 * `expo-constants` rather than `expo-application`: the latter reads the version
 * off the installed binary, which is strictly more correct, but it is a native
 * module and — with no OTA in this architecture — the embedded manifest and the
 * binary can never disagree.
 */
const VERSAO_INSTALADA = Constants.expoConfig?.version ?? "0.0.0";

export interface EstadoAtualizacao {
  versaoInstalada: string;
  /** Null while the check has not succeeded — offline, throttled, or nothing published. */
  release: AppRelease | null;
  /** Already discounts a dismissal of this exact version. */
  temAtualizacao: boolean;
  dispensar: () => void;
}

export function useAppUpdate(): EstadoAtualizacao {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [dispensada, setDispensada] = useState<string | null>(null);

  const checar = useCallback(async () => {
    const ultima = await getUltimaChecagem();
    const agora = Date.now();
    if (ultima !== null && agora - ultima < INTERVALO_CHECAGEM_MS) {
      return;
    }
    setDispensada(await getVersaoDispensada());
    const publicado = await getAppVersion();
    setRelease(publicado);
    await marcarChecagem(agora);
  }, []);

  useEffect(() => {
    // Every failure path ends here: offline, timeout, 404 (nothing published),
    // malformed body. The screen simply never learns about an update, which is
    // the designed behaviour — a broken check must not surface to the user.
    void checar().catch(() => undefined);

    const subscription = AppState.addEventListener("change", (estado) => {
      if (estado === "active") {
        void checar().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [checar]);

  const dispensar = useCallback(() => {
    if (!release) {
      return;
    }
    setDispensada(release.latestVersion);
    void dispensarVersao(release.latestVersion).catch(() => undefined);
  }, [release]);

  const temAtualizacao =
    release !== null &&
    haAtualizacao(VERSAO_INSTALADA, release.latestVersion) &&
    dispensada !== release.latestVersion;

  return { versaoInstalada: VERSAO_INSTALADA, release, temAtualizacao, dispensar };
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `cd mobile && npx jest src/lib/use-app-update.test.tsx`
Expected: PASS, 5 tests.

If a test warns about state updates outside `act`, note that RTL v14 renders asynchronously here — the `waitFor` assertions above are what settle it. Do not add `jest.useFakeTimers()` to this file.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/use-app-update.ts mobile/src/lib/use-app-update.test.tsx
git commit -m "feat(mobile): add the throttled, fail-silent update check hook"
```

---

### Task 6: Nativo — versionCode, permissão de instalação, intent launcher

**Files:**
- Modify: `mobile/app.json`
- Modify: `mobile/package.json` (via `npx expo install`)

**Interfaces:**
- Consumes: nada.
- Produces: `expo-intent-launcher` disponível como dependência, permissão `REQUEST_INSTALL_PACKAGES` declarada, `android.versionCode` presente. A Task 7 depende de tudo isso.

Esta task não tem teste automatizado — é configuração nativa, e a verificação é o build.

- [ ] **Step 1: Install the intent launcher**

Run: `cd mobile && npx expo install expo-intent-launcher`

- [ ] **Step 2: Add the version code and the permission**

In `mobile/app.json`, inside `expo.android`, add:

```json
"versionCode": 1,
"permissions": ["REQUEST_INSTALL_PACKAGES"]
```

The resulting `expo.android` block keeps its existing `package`, `adaptiveIcon`, `backgroundColor` and `predictiveBackGestureEnabled` keys — only these two are new.

- [ ] **Step 3: Regenerate the native project**

Run: `cd mobile && npx expo prebuild --platform android --clean`

This is mandatory: `android/` is a gitignored artifact, so a new permission or plugin in `app.json` reaches the build only through prebuild.

- [ ] **Step 4: Verify the permission actually landed**

Run: `cd mobile && grep REQUEST_INSTALL_PACKAGES android/app/src/main/AndroidManifest.xml`
Expected: one matching `<uses-permission ... />` line. If it is absent, the prebuild did not pick up the change — do not continue to Task 7.

- [ ] **Step 5: Verify the app still builds and runs**

Run: `cd mobile && npm run android`
Expected: the app installs on the device/emulator and opens as before.

- [ ] **Step 6: Commit**

```bash
git add mobile/app.json mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): declare versionCode and the install-packages permission"
```

---

### Task 7: Mobile — download e instalação do APK

**Files:**
- Create: `mobile/src/lib/app-update-install.ts`
- Test: `mobile/src/lib/app-update-install.test.ts`

**Interfaces:**
- Consumes: `expo-file-system` (API moderna), `expo-intent-launcher`.
- Produces: `baixarEInstalar(downloadUrl: string, versao: string, onProgresso: (fracao: number | null) => void): Promise<void>`, que rejeita com `InstalacaoIndisponivelError` quando a intent não pode ser disparada. A Task 8 consome os dois.

`onProgresso` recebe `null` quando não há fração calculável — o servidor não mandou `Content-Length` e o `totalBytes` chega como `-1`. A Task 8 renderiza estado indeterminado nesse caso, em vez de inventar um número.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/lib/app-update-install.test.ts`:

```ts
import { File } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

import { baixarEInstalar, InstalacaoIndisponivelError } from "./app-update-install";

jest.mock("expo-file-system", () => {
  class FileFake {
    static downloadFileAsync = jest.fn();
    contentUri = "content://gradline/gradline-1.1.0.apk";
    delete = jest.fn();
    constructor(...uris: unknown[]) {
      (FileFake as unknown as { ultimaConstrucao: unknown[] }).ultimaConstrucao = uris;
    }
  }
  return { File: FileFake, Directory: class {}, Paths: { cache: { uri: "file:///cache/" } } };
});
jest.mock("expo-intent-launcher", () => ({
  startActivityAsync: jest.fn().mockResolvedValue({ resultCode: 0 }),
}));

const mockedIntent = jest.mocked(IntentLauncher);
const FileFake = File as unknown as {
  downloadFileAsync: jest.Mock;
  ultimaConstrucao: unknown[];
};

/** The File the download resolves to, so a test can inspect contentUri/delete. */
function baixado(): { contentUri: string; delete: jest.Mock } {
  const arquivo = new (File as unknown as new () => {
    contentUri: string;
    delete: jest.Mock;
  })();
  FileFake.downloadFileAsync.mockResolvedValue(arquivo);
  return arquivo;
}

describe("baixarEInstalar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("downloads into the cache directory under a version-stamped name", async () => {
    baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(FileFake.ultimaConstrucao[1]).toBe("gradline-1.1.0.apk");
    expect(FileFake.downloadFileAsync).toHaveBeenCalledWith(
      "https://example.com/app.apk",
      expect.anything(),
      expect.objectContaining({ idempotent: true }),
    );
  });

  it("reports progress as a 0..1 fraction", async () => {
    baixado();
    const progresso: (number | null)[] = [];

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", (f) => progresso.push(f));

    const { onProgress } = FileFake.downloadFileAsync.mock.calls[0][2];
    onProgress({ bytesWritten: 50, totalBytes: 200 });
    expect(progresso).toContain(0.25);
  });

  it("reports null when the server sends no Content-Length", async () => {
    baixado();
    const progresso: (number | null)[] = [];

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", (f) => progresso.push(f));

    const { onProgress } = FileFake.downloadFileAsync.mock.calls[0][2];
    // expo-file-system reports totalBytes as -1 in that case.
    onProgress({ bytesWritten: 50, totalBytes: -1 });
    expect(progresso).toContain(null);
  });

  it("fires the install intent with the file's content uri and read permission", async () => {
    baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(mockedIntent.startActivityAsync).toHaveBeenCalledWith(
      "android.intent.action.INSTALL_PACKAGE",
      expect.objectContaining({
        data: "content://gradline/gradline-1.1.0.apk",
        flags: 1,
      }),
    );
  });

  it("deletes the downloaded apk after handing it to the installer", async () => {
    const arquivo = baixado();

    await baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {});

    expect(arquivo.delete).toHaveBeenCalled();
  });

  it("still deletes the file when the installer cannot be reached", async () => {
    const arquivo = baixado();
    mockedIntent.startActivityAsync.mockRejectedValue(new Error("no activity"));

    await expect(
      baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {}),
    ).rejects.toBeInstanceOf(InstalacaoIndisponivelError);
    expect(arquivo.delete).toHaveBeenCalled();
  });

  it("propagates a failed download without touching the installer", async () => {
    FileFake.downloadFileAsync.mockRejectedValue(new Error("network"));

    await expect(
      baixarEInstalar("https://example.com/app.apk", "1.1.0", () => {}),
    ).rejects.toThrow("network");
    expect(mockedIntent.startActivityAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/lib/app-update-install.test.ts`
Expected: FAIL — `Cannot find module './app-update-install'`.

- [ ] **Step 3: Implement**

Create `mobile/src/lib/app-update-install.ts`:

```ts
import { File, Paths } from "expo-file-system";
import * as IntentLauncher from "expo-intent-launcher";

/**
 * Downloads the published APK and hands it to Android's package installer.
 *
 * Deliberately on the modern expo-file-system API, never `expo-file-system/legacy`:
 * the legacy surface is deprecated, and since SDK 56 the modern one covers both
 * things this needs — `onProgress` on the download, and `File#contentUri`
 * (Android), which is the FileProvider `content://` URI the installer requires.
 *
 * The file lands in the cache directory, not Downloads: invisible to the file
 * manager, deletable by the system under storage pressure, and deleted here as
 * soon as the installer has it.
 */

/** Android's install intent. Not exported by expo-intent-launcher as a constant. */
const ACTION_INSTALL_PACKAGE = "android.intent.action.INSTALL_PACKAGE";
/** FLAG_GRANT_READ_URI_PERMISSION — without it the installer cannot read the uri. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** The installer could not be reached — the caller should fall back to the site. */
export class InstalacaoIndisponivelError extends Error {
  constructor() {
    super("Não foi possível abrir o instalador do sistema");
    this.name = "InstalacaoIndisponivelError";
  }
}

export async function baixarEInstalar(
  downloadUrl: string,
  versao: string,
  onProgresso: (fracao: number | null) => void,
): Promise<void> {
  const destino = new File(Paths.cache, `gradline-${versao}.apk`);

  // A failed download leaves nothing worth cleaning up and nothing to install.
  // `idempotent` so a retry after a partial download overwrites instead of throwing.
  const arquivo = await File.downloadFileAsync(downloadUrl, destino, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // totalBytes is -1 when the server sent no Content-Length. There is no
      // fraction to report then, and the card shows an indeterminate state
      // rather than a number the download cannot back up.
      onProgresso(totalBytes > 0 ? bytesWritten / totalBytes : null);
    },
  });

  try {
    await IntentLauncher.startActivityAsync(ACTION_INSTALL_PACKAGE, {
      data: arquivo.contentUri,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  } catch {
    throw new InstalacaoIndisponivelError();
  } finally {
    // The installer has already copied what it needs by the time the intent
    // returns; keeping the apk around would be the "duplicate file" problem
    // this whole approach exists to avoid.
    try {
      arquivo.delete();
    } catch {
      // A file the system already reclaimed is not a failure worth surfacing.
    }
  }
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `cd mobile && npx jest src/lib/app-update-install.test.ts`
Expected: PASS, 7 tests.

O trecho de `expo-file-system` da implementação acima já foi typechecado contra a
API real da 57.0.5 instalada — construtor de `File`, `Paths.cache`, o objeto de
opções com `idempotent`/`onProgress`, `arquivo.contentUri` e `arquivo.delete()`.
Se o `tsc` reclamar de algum desses, a causa é uma versão diferente do pacote,
não o código.

- [ ] **Step 5: Verify the content URI on a real device**

Unit tests cannot catch this one. `File#contentUri` depends on the FileProvider the Expo module registers, and a broken FileProvider surfaces only at runtime — the legacy `getContentUriAsync` shipped exactly that failure on SDK 54 for some apps (`Couldn't find meta-data for provider with authority <package>.FileSystemFileProvider`, expo/expo#39056).

Run `npm run android`, trigger the update flow against a real published APK, and confirm the system install dialog opens. If it throws a FileProvider authority error, stop and report it — the fix is a native config question, not something to patch around in this task.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/app-update-install.ts mobile/src/lib/app-update-install.test.ts
git commit -m "feat(mobile): download the apk to cache and hand it to the installer"
```

---

### Task 8: Mobile — card de atualização na Home

**Files:**
- Create: `mobile/src/components/UpdateCard.tsx`
- Modify: `mobile/src/screens/HomeTab.tsx`
- Test: `mobile/src/__tests__/update-card.test.tsx`

**Interfaces:**
- Consumes: `useAppUpdate` (Task 5), `baixarEInstalar`/`InstalacaoIndisponivelError` (Task 7).
- Produces: `<UpdateCard />`, sem props — lê tudo do hook. `HomeTab` apenas o monta.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/__tests__/update-card.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { UpdateCard } from "@/components/UpdateCard";
import { baixarEInstalar, InstalacaoIndisponivelError } from "@/lib/app-update-install";
import { useAppUpdate } from "@/lib/use-app-update";

jest.mock("@/lib/use-app-update");
jest.mock("@/lib/app-update-install", () => ({
  baixarEInstalar: jest.fn().mockResolvedValue(undefined),
  InstalacaoIndisponivelError: class extends Error {},
}));

jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress, isDisabled }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Spinner: () => <View testID="spinner" />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#000000",
  };
});

const RELEASE = {
  latestVersion: "1.1.0",
  versionCode: 3,
  downloadUrl: "https://example.com/gradline-1.1.0.apk",
  releaseNotes: "Optativas na Trajetória.",
  publishedAt: "2026-09-01T12:00:00Z",
};

function comAtualizacao(overrides = {}) {
  jest.mocked(useAppUpdate).mockReturnValue({
    versaoInstalada: "1.0.0",
    release: RELEASE,
    temAtualizacao: true,
    dispensar: jest.fn(),
    ...overrides,
  });
}

describe("UpdateCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when there is no update", () => {
    jest.mocked(useAppUpdate).mockReturnValue({
      versaoInstalada: "1.0.0",
      release: null,
      temAtualizacao: false,
      dispensar: jest.fn(),
    });

    render(<UpdateCard />);

    expect(screen.queryByTestId("update-card")).toBeNull();
  });

  it("announces the new version and its notes", () => {
    comAtualizacao();

    render(<UpdateCard />);

    expect(screen.getByTestId("update-card")).toBeTruthy();
    expect(screen.getByText(/1\.1\.0/)).toBeTruthy();
    expect(screen.getByText("Optativas na Trajetória.")).toBeTruthy();
  });

  it("downloads and installs when the user accepts", async () => {
    comAtualizacao();

    render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    await waitFor(() =>
      expect(baixarEInstalar).toHaveBeenCalledWith(
        RELEASE.downloadUrl,
        "1.1.0",
        expect.any(Function),
      ),
    );
  });

  it("renders the measured progress as a filled bar", async () => {
    comAtualizacao();
    jest.mocked(baixarEInstalar).mockImplementation(async (_url, _v, onProgresso) => {
      onProgresso(0.4);
    });

    render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    const barra = await screen.findByTestId("update-progress-fill");
    expect(barra.props.style).toEqual(expect.objectContaining({ width: "40%" }));
  });

  it("falls back to an indeterminate state when the size is unknown", async () => {
    comAtualizacao();
    jest.mocked(baixarEInstalar).mockImplementation(async (_url, _v, onProgresso) => {
      onProgresso(null);
    });

    render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    expect(await screen.findByTestId("update-progress-indeterminate")).toBeTruthy();
    expect(screen.queryByTestId("update-progress-fill")).toBeNull();
  });

  it("opens the site when the system installer cannot be reached", async () => {
    comAtualizacao();
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    jest.mocked(baixarEInstalar).mockRejectedValue(new InstalacaoIndisponivelError());

    render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-install"));

    await waitFor(() => expect(openURL).toHaveBeenCalledWith(RELEASE.downloadUrl));
  });

  it("dismisses without installing", () => {
    const dispensar = jest.fn();
    comAtualizacao({ dispensar });

    render(<UpdateCard />);
    fireEvent.press(screen.getByTestId("update-dismiss"));

    expect(dispensar).toHaveBeenCalled();
    expect(baixarEInstalar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/__tests__/update-card.test.tsx`
Expected: FAIL — `Cannot find module '@/components/UpdateCard'`.

- [ ] **Step 3: Implement the card**

Create `mobile/src/components/UpdateCard.tsx`:

```tsx
import { Button, Spinner, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Linking, Pressable, View } from "react-native";

import { baixarEInstalar, InstalacaoIndisponivelError } from "@/lib/app-update-install";
import { useAppUpdate } from "@/lib/use-app-update";

/**
 * The one place the app nags. Renders nothing at all unless a strictly newer
 * version is published and the user has not dismissed that exact version.
 *
 * Unlike DownloadProgressBar — which paces a calibrated guess because the SIGAA
 * download is an opaque POST — the bar here is measured: expo-file-system 57
 * reports bytes written. When the server sends no Content-Length there is no
 * fraction, and the card says so with a spinner instead of inventing one.
 */
export function UpdateCard(): JSX.Element | null {
  const { release, temAtualizacao, dispensar } = useAppUpdate();
  /** null = idle; a number = measured fraction; NaN-free "unknown" = -1. */
  const [progresso, setProgresso] = useState<number | null>(null);
  const [baixando, setBaixando] = useState(false);

  const instalar = useCallback(async () => {
    if (!release) {
      return;
    }
    setBaixando(true);
    setProgresso(null);
    try {
      await baixarEInstalar(release.downloadUrl, release.latestVersion, setProgresso);
    } catch (erro) {
      // Whatever went wrong — no installer activity, permission refused, a
      // failed download — the manual path never stops existing.
      if (erro instanceof InstalacaoIndisponivelError) {
        void Linking.openURL(release.downloadUrl);
      }
      setBaixando(false);
      setProgresso(null);
    }
  }, [release]);

  if (!temAtualizacao || !release) {
    return null;
  }

  return (
    <View testID="update-card" className="rounded-3xl bg-surface-secondary p-5 gap-3">
      <Typography.Heading type="h5">{`Versão ${release.latestVersion} disponível`}</Typography.Heading>
      {release.releaseNotes.length > 0 && (
        <Typography.Paragraph type="body-sm" color="muted">
          {release.releaseNotes}
        </Typography.Paragraph>
      )}

      {baixando ? (
        <View className="gap-2">
          {progresso === null ? (
            <View testID="update-progress-indeterminate" className="flex-row items-center gap-3">
              <Spinner size="sm" />
            </View>
          ) : (
            <View className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <View
                testID="update-progress-fill"
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(progresso * 100)}%` }}
              />
            </View>
          )}
          <Typography.Paragraph type="body-sm" color="muted">
            Baixando a atualização…
          </Typography.Paragraph>
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          <Button testID="update-install" size="sm" onPress={instalar}>
            Atualizar
          </Button>
          <Pressable testID="update-dismiss" onPress={dispensar}>
            <Typography.Paragraph type="body-sm" color="muted">
              Agora não
            </Typography.Paragraph>
          </Pressable>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `cd mobile && npx jest src/__tests__/update-card.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mount it on the Home screen**

In `mobile/src/screens/HomeTab.tsx`, add the import:

```tsx
import { UpdateCard } from "@/components/UpdateCard";
```

and render it as the first child inside the `<ScrollView testID="home-schedule-scroll">`, above the `"Sua semana"` heading row:

```tsx
<UpdateCard />
```

It renders `null` when there is no update, so the layout is untouched in the common case.

- [ ] **Step 6: Run the Home suite to confirm nothing regressed**

Run: `cd mobile && npx jest src/__tests__/home.test.tsx`
Expected: PASS. If `useAppUpdate` reaches the network in these tests, add `jest.mock("@/lib/use-app-update")` at the top of `home.test.tsx` returning `{ versaoInstalada: "1.0.0", release: null, temAtualizacao: false, dispensar: jest.fn() }`.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/components/UpdateCard.tsx mobile/src/screens/HomeTab.tsx mobile/src/__tests__/update-card.test.tsx mobile/src/__tests__/home.test.tsx
git commit -m "feat(mobile): announce a new version on the home screen"
```

---

### Task 9: Mobile — versão instalada no Perfil

**Files:**
- Modify: `mobile/src/app/(tabs)/ajustes.tsx`
- Test: `mobile/src/__tests__/ajustes.test.tsx`

**Interfaces:**
- Consumes: `useAppUpdate` (Task 5).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/__tests__/ajustes.test.tsx`, adding `jest.mock("@/lib/use-app-update")` alongside the other module mocks at the top of the file:

```tsx
describe("app version row", () => {
  it("shows the installed version and says it is up to date", async () => {
    jest.mocked(useAppUpdate).mockReturnValue({
      versaoInstalada: "1.1.0",
      release: {
        latestVersion: "1.1.0",
        versionCode: 3,
        downloadUrl: "https://example.com/app.apk",
        releaseNotes: "",
        publishedAt: "2026-09-01T12:00:00Z",
      },
      temAtualizacao: false,
      dispensar: jest.fn(),
    });

    render(<AjustesScreen />);

    expect(await screen.findByTestId("app-version-item")).toBeTruthy();
    expect(screen.getByText("1.1.0")).toBeTruthy();
    expect(screen.getByText("Você está na versão mais recente")).toBeTruthy();
  });

  it("says a new version is available when one is", async () => {
    jest.mocked(useAppUpdate).mockReturnValue({
      versaoInstalada: "1.0.0",
      release: {
        latestVersion: "1.1.0",
        versionCode: 3,
        downloadUrl: "https://example.com/app.apk",
        releaseNotes: "",
        publishedAt: "2026-09-01T12:00:00Z",
      },
      temAtualizacao: true,
      dispensar: jest.fn(),
    });

    render(<AjustesScreen />);

    expect(await screen.findByText("Nova versão disponível: 1.1.0")).toBeTruthy();
  });

  it("still shows the installed version when the check never succeeded", async () => {
    jest.mocked(useAppUpdate).mockReturnValue({
      versaoInstalada: "1.0.0",
      release: null,
      temAtualizacao: false,
      dispensar: jest.fn(),
    });

    render(<AjustesScreen />);

    expect(await screen.findByText("1.0.0")).toBeTruthy();
    // No claim either way — the app does not know, and must not guess.
    expect(screen.queryByText("Você está na versão mais recente")).toBeNull();
  });
});
```

Use whatever import name the file already uses for the screen component and for `render`/`screen`; add `import { useAppUpdate } from "@/lib/use-app-update";` to the imports.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest src/__tests__/ajustes.test.tsx -t "app version row"`
Expected: FAIL — `Unable to find an element with testID: app-version-item`.

- [ ] **Step 3: Implement the row**

In `mobile/src/app/(tabs)/ajustes.tsx`, add the import:

```tsx
import { useAppUpdate } from "@/lib/use-app-update";
```

call the hook alongside the screen's other hooks:

```tsx
const { versaoInstalada, release, temAtualizacao } = useAppUpdate();
```

and add a new section immediately above the "Sair da conta" block, following the shape of the "Integrações" group:

```tsx
<Animated.View style={{ gap: 10 }} layout={LinearTransition.duration(ACCORDION_MS)}>
  <Typography.Paragraph type="body-xs" color="muted">
    Sobre
  </Typography.Paragraph>
  <ListGroup>
    <ListGroup.Item testID="app-version-item" disabled>
      <ListGroup.ItemPrefix>
        <AppIcon name="IconInfo" size={22} color={mutedColor} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>Versão do app</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>
          {/* Silence, not a guess, when the check never landed: claiming
              "up to date" while offline would be a lie the user cannot check. */}
          {temAtualizacao
            ? `Nova versão disponível: ${release?.latestVersion}`
            : release
              ? "Você está na versão mais recente"
              : ""}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <Typography.Paragraph type="body-sm" color="muted">
          {versaoInstalada}
        </Typography.Paragraph>
      </ListGroup.ItemSuffix>
    </ListGroup.Item>
  </ListGroup>
</Animated.View>
```

If `IconInfo` is not a valid `AppIconName`, pick the closest existing name from `mobile/src/components/AppIcon.tsx` rather than inventing one.

- [ ] **Step 4: Run the tests — they pass**

Run: `cd mobile && npx jest src/__tests__/ajustes.test.tsx`
Expected: PASS, including the 3 new tests.

- [ ] **Step 5: Typecheck and lint the whole mobile app**

Run: `cd mobile && npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add "mobile/src/app/(tabs)/ajustes.tsx" mobile/src/__tests__/ajustes.test.tsx
git commit -m "feat(mobile): show the installed app version in Perfil"
```

---

### Task 10: Landing page

**Files:**
- Create: `landing/index.html`
- Create: `landing/style.css`
- Create: `landing/README.md`

**Interfaces:**
- Consumes: nada.
- Produces: nada consumido por código.

Sem teste automatizado — é uma página estática. A verificação é abrir no navegador.

- [ ] **Step 1: Write the page**

Create `landing/index.html` with, in this order:

- `<title>` e um `<h1>` com o nome do app.
- Duas frases sobre o que ele é.
- Um `<a class="download" href="...">Baixar o APK</a>` apontando pro asset do GitHub Release (deixar a URL da release atual; ela muda a cada lançamento).
- Uma seção **"Como instalar"** com os passos: baixar, tocar no arquivo, e — quando o Android pedir — permitir a instalação de apps de fontes desconhecidas para o navegador usado. Descrever o caminho `Configurações › Apps › Acesso especial › Instalar apps desconhecidos`.
- Uma seção **"Novidades"** com o changelog, mais recente no topo.
- Uma seção **"E o iPhone?"** dizendo, sem rodeios, que não existe versão iOS porque distribuir fora da App Store exige uma conta paga de desenvolvedor, e que o app é um projeto sem fins lucrativos.

Escrever em português do Brasil. Sem framework, sem build: HTML e CSS puros.

- [ ] **Step 2: Write the styles**

Create `landing/style.css` — uma coluna centrada com largura máxima legível, tipografia do sistema, e o botão de download em destaque. Sem dependências externas.

- [ ] **Step 3: Document the deploy**

Create `landing/README.md` explicando: a página é estática, é publicada em Cloudflare Pages ou GitHub Pages apontando pra este diretório, e o subdomínio é configurado no DNS do domínio já existente. Anotar qual das duas foi escolhida assim que estiver no ar.

- [ ] **Step 4: Check it in a browser**

Run: `cd landing && python3 -m http.server 8000`
Abrir `http://localhost:8000` e conferir que o botão, as seções e o layout aparecem como esperado. Encerrar o servidor depois.

- [ ] **Step 5: Commit**

```bash
git add landing
git commit -m "feat(landing): add the static download page for the apk"
```

---

### Task 11: Documentar o processo de release e a custódia da keystore

**Files:**
- Create: `docs/reference/release.md`

**Interfaces:**
- Consumes: nada.
- Produces: nada consumido por código.

- [ ] **Step 1: Write the document**

Create `docs/reference/release.md` com, nesta ordem:

1. **A keystore.** Que a chave de assinatura é irreversível: mudar de chave faz o Android recusar a atualização com "app não instalado", e o usuário só prossegue desinstalando e perdendo os dados locais. Registrar **qual** keystore é a oficial (EAS gerenciada ou arquivo local), onde o backup dela está guardado, e que ela nunca muda. Se for EAS, anotar que `eas credentials` permite baixar o backup e que isso já foi feito.
2. **O checklist de release**, copiando os cinco passos da seção "Processo de release" da spec — subir `version` e `versionCode`, buildar, publicar no GitHub Releases, apontar as variáveis do Railway, atualizar o changelog da landing.
3. **Que o passo 4 é o que lança.** Enquanto as variáveis do Railway não mudarem, o APK existe e ninguém é avisado — o que permite escolher o momento e reverter apontando de volta pra versão anterior, sem rebuild.
4. **As variáveis de ambiente**, com um exemplo real de cada: `APP_LATEST_VERSION`, `APP_LATEST_VERSION_CODE`, `APP_DOWNLOAD_URL`, `APP_RELEASE_NOTES`, `APP_PUBLISHED_AT`.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/release.md
git commit -m "docs: record the release checklist and the keystore custody rule"
```

---

## Self-Review

**Cobertura da spec:**

| Requisito da spec | Task |
|---|---|
| App conhece a própria versão | 5 (`VERSAO_INSTALADA` via expo-constants) |
| `versionCode` no `app.json` | 6 |
| Endpoint público de versão | 1 |
| Aviso na Home, dispensável por versão | 4, 5, 8 |
| Versão explícita no Perfil | 9 |
| Download + instalação dentro do app | 6, 7, 8 |
| Sem dependência do subpath `legacy` (depreciado) | 7 |
| Fallback pro navegador | 8 |
| Checagem 1×/hora, cold start + foreground | 5 |
| Falha é silêncio | 5 (hook), 8 (card renderiza `null`), 9 (descrição vazia) |
| Landing estática | 10 |
| Keystore congelada + processo de release | 11 |
| `minSupportedVersion` fora de escopo | nenhuma task — correto |
| OTA fora de escopo | nenhuma task — correto |

**Correção à spec, aplicada aqui:** a spec dizia reusar `DownloadProgressBar`. Esse componente encena progresso calibrado a partir de estágios conhecidos do backend, que não existem no download de um APK. A Task 8 desenha a mesma linguagem visual, mas alimentada pelo `onProgress` do `expo-file-system` 57 — medição real — e cai num spinner indeterminado quando o servidor não manda `Content-Length`.

**Consistência de tipos:** `AppRelease` tem os mesmos cinco campos no backend (Task 1) e no mobile (Task 3). `useAppUpdate` devolve `{ versaoInstalada, release, temAtualizacao, dispensar }` na Task 5 e é consumido com exatamente essas chaves nas Tasks 8 e 9. `baixarEInstalar(url, versao, onProgresso)` é definido na Task 7 e chamado com essa assinatura na Task 8, onde `onProgresso` recebe `number | null`.
