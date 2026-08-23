# Mobile Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UFBA mobile app's first screen — Google Sign-In — that authenticates against the existing `POST /auth/google` backend endpoint, persists the session, and gates access to the existing `(tabs)` group.

**Architecture:** `@react-native-google-signin/google-signin` (native Google SDK, requires a local Android dev client build) obtains a Google `idToken`; a small `lib/` layer (`session-storage.ts`, `api.ts`, `auth-context.tsx`) exchanges it with the backend, persists the resulting session in `expo-secure-store`, and exposes auth state via a `useAuth()` hook. The root layout uses Expo Router's `Stack.Protected` to show `login` or `(tabs)` based on that state.

**Tech Stack:** Expo SDK 54, Expo Router ~6, React 19, HeroUI Native, `@react-native-google-signin/google-signin`, `expo-secure-store`, `expo-dev-client`, Jest (`jest-expo` preset) + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-08-17-mobile-google-login-design.md](../specs/2026-08-17-mobile-google-login-design.md)

## Global Constraints

- Android only for this pass — no iOS OAuth client, no `iosUrlScheme`, no iOS build. All `prebuild`/`run` commands target `--platform android` explicitly.
- Expo Go cannot run this feature (native module) — every manual test after Task 1 uses a local dev client build (`npx expo run:android`), not Expo Go.
- No refresh tokens, no screen between login and `(tabs)`, no backend changes — see spec's "Explicitly out of scope."
- `GoogleSignin.configure({ webClientId })` uses `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, which must equal the backend's `GOOGLE_CLIENT_ID` (`backend/.env`) — same Google Web OAuth client on both sides, or token verification fails.
- All new mobile source files use the project's existing conventions: `type JSX` return types, `@/` path alias (`mobile/tsconfig.json` already maps `@/*` → `./src/*` and `@/assets/*` → `./assets/*`), Uniwind `className` styling (not `StyleSheet`), HeroUI Native components (`Typography`, not raw RN `Text`, for on-screen copy).

---

### Task 1: Native dependencies, app config, and Android dev client build

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/app.json`
- Create: `mobile/.env.example`
- Create: `mobile/.env` (gitignored — not committed)

**Interfaces:**
- Produces: an installable `@react-native-google-signin/google-signin` native module, an `android/` project generated via `prebuild`, and `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_GOOGLE_CLIENT_ID` available at runtime via `process.env` for later tasks.

- [ ] **Step 1: Install the new packages**

Run from `mobile/`:

```bash
npx expo install @react-native-google-signin/google-signin expo-dev-client expo-secure-store
```

This picks SDK-54-compatible versions and adds them to `package.json` `dependencies`.

- [ ] **Step 2: Set the Android package name and register the config plugin**

Edit `mobile/app.json` — add `"package"` under `"android"`, add `"bundleIdentifier"` under `"ios"` (unused this pass, but required by some tooling once either is set — harmless to set both), and add the Google Sign-In plugin:

```json
{
  "expo": {
    "name": "mobile",
    "slug": "mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "heroui-native-app",
    "userInterfaceStyle": "automatic",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.ufba.app"
    },
    "android": {
      "package": "com.ufba.app",
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "predictiveBackGestureEnabled": false
    },
    "plugins": [
      "expo-router",
      "expo-font",
      "@react-native-google-signin/google-signin",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    }
  }
}
```

(`com.ufba.app` is a placeholder reverse-DNS package name — fine pre-launch, easy to change later before any store submission.)

- [ ] **Step 3: Create the env files**

Create `mobile/.env.example`:

```bash
# Same Web OAuth client ID as backend/.env's GOOGLE_CLIENT_ID — must match,
# or the backend will reject the idToken (audience mismatch).
EXPO_PUBLIC_GOOGLE_CLIENT_ID=

# Backend base URL reachable from your physical device — use your machine's
# LAN IP, not localhost (the device isn't your machine).
EXPO_PUBLIC_API_URL=
```

Create `mobile/.env` (already covered by the repo's root `.gitignore` `.env` rule — confirm with `git check-ignore -v mobile/.env` before moving on) with real values: `EXPO_PUBLIC_GOOGLE_CLIENT_ID` copied from `backend/.env`'s `GOOGLE_CLIENT_ID`, and `EXPO_PUBLIC_API_URL` set to `http://<your-lan-ip>:3000`.

- [ ] **Step 4: Generate the native Android project and confirm it builds config correctly**

```bash
npx expo prebuild --platform android --clean
```

Expected: completes without errors and creates `mobile/android/` (already gitignored — don't `git add` it). If it errors about a missing `package` field, re-check Step 2. Don't run `npx expo run:android` yet — no code uses the native module until later tasks; that full build + install happens in Task 7.

- [ ] **Step 5: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.json mobile/.env.example
git commit -m "chore(mobile): add google-signin, expo-dev-client, and app config for Android dev client"
```

(`mobile/.env` and `mobile/android/` are gitignored — nothing to add for those.)

---

### Task 2: Session types and secure storage

**Files:**
- Create: `mobile/src/lib/types.ts`
- Create: `mobile/src/lib/session-storage.ts`
- Test: `mobile/src/lib/session-storage.test.ts`
- Modify: `mobile/package.json` (test tooling)

**Interfaces:**
- Produces:
  - `GoogleUserInfo { googleId: string; email: string; name: string }` (`types.ts`)
  - `Session { accessToken: string; user: GoogleUserInfo }` (`types.ts`)
  - `getSession(): Promise<Session | null>` (`session-storage.ts`)
  - `saveSession(session: Session): Promise<void>` (`session-storage.ts`)
  - `clearSession(): Promise<void>` (`session-storage.ts`)

- [ ] **Step 1: Add test tooling**

Run from `mobile/`:

```bash
npx expo install jest-expo --dev
npm install --save-dev jest @testing-library/react-native @types/jest
```

Add to `mobile/package.json`:

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo"
  }
}
```

(Add `"test": "jest"` alongside the existing scripts; add the top-level `"jest"` key alongside `"scripts"`/`"dependencies"`.)

- [ ] **Step 2: Write `types.ts`**

```ts
export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
}

export interface Session {
  accessToken: string;
  user: GoogleUserInfo;
}
```

- [ ] **Step 3: Write the failing test for `session-storage.ts`**

`mobile/src/lib/session-storage.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import { clearSession, getSession, saveSession } from "./session-storage";
import type { Session } from "./types";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

const SESSION: Session = {
  accessToken: "token",
  user: { googleId: "1", email: "a@b.com", name: "A" },
};

describe("session-storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when nothing is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    await expect(getSession()).resolves.toBeNull();
  });

  it("returns the parsed session when one is stored", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(SESSION));

    await expect(getSession()).resolves.toEqual(SESSION);
  });

  it("returns null when the stored value is corrupted JSON", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue("not-json");

    await expect(getSession()).resolves.toBeNull();
  });

  it("saves the session as JSON under the session key", async () => {
    await saveSession(SESSION);

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      "ufba.session",
      JSON.stringify(SESSION),
    );
  });

  it("clears the stored session", async () => {
    await clearSession();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith("ufba.session");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- session-storage`
Expected: FAIL — `Cannot find module './session-storage'` (file doesn't exist yet).

- [ ] **Step 5: Implement `session-storage.ts`**

```ts
import * as SecureStore from "expo-secure-store";

import type { Session } from "./types";

const SESSION_KEY = "ufba.session";

export async function getSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- session-storage`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/lib/types.ts mobile/src/lib/session-storage.ts mobile/src/lib/session-storage.test.ts
git commit -m "feat(mobile): add session types and secure-store-backed session storage"
```

---

### Task 3: Backend API client

**Files:**
- Create: `mobile/src/lib/api.ts`
- Test: `mobile/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `Session` from `./types` (Task 2)
- Produces: `ApiError extends Error` and `postGoogleLogin(idToken: string): Promise<Session>` (`api.ts`)

- [ ] **Step 1: Write the failing test**

`mobile/src/lib/api.test.ts`:

```ts
import { ApiError, postGoogleLogin } from "./api";
import type { Session } from "./types";

const LOGIN_RESPONSE: Session = {
  accessToken: "token",
  user: { googleId: "1", email: "a@b.com", name: "A" },
};

describe("postGoogleLogin", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the idToken and returns the parsed login response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => LOGIN_RESPONSE,
    });

    await expect(postGoogleLogin("id-token")).resolves.toEqual(LOGIN_RESPONSE);

    expect(global.fetch).toHaveBeenCalledWith("http://192.168.1.10:3000/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "id-token" }),
    });
  });

  it("throws ApiError when the backend responds with a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(postGoogleLogin("bad-token")).rejects.toThrow(ApiError);
  });

  it("throws ApiError when EXPO_PUBLIC_API_URL is not configured", async () => {
    delete process.env.EXPO_PUBLIC_API_URL;

    await expect(postGoogleLogin("id-token")).rejects.toThrow(ApiError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- api.test`
Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 3: Implement `api.ts`**

```ts
import type { Session } from "./types";

export class ApiError extends Error {}

export async function postGoogleLogin(idToken: string): Promise<Session> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not configured");
  }

  const response = await fetch(`${baseUrl}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    throw new ApiError(`Google login failed with status ${response.status}`);
  }

  return (await response.json()) as Session;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- api.test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): add postGoogleLogin API client"
```

---

### Task 4: Auth context and Google Sign-In configuration

**Files:**
- Create: `mobile/src/lib/auth-context.tsx`
- Create: `mobile/src/lib/google-signin.ts`
- Test: `mobile/src/lib/auth-context.test.tsx`
- Test: `mobile/src/lib/google-signin.test.ts`

**Interfaces:**
- Consumes: `postGoogleLogin` (`./api`, Task 3), `getSession`/`saveSession`/`clearSession` (`./session-storage`, Task 2), `Session`/`GoogleUserInfo` (`./types`, Task 2)
- Produces:
  - `AuthProvider` (React component) and `useAuth(): { status: 'loading' | 'signedOut' | 'signedIn', accessToken?, user?, signIn(idToken: string): Promise<void>, signOut(): Promise<void> }` (`auth-context.tsx`) — consumed by Task 5 (`login.tsx`) and Task 6 (`_layout.tsx`)
  - `configureGoogleSignin(): void` (`google-signin.ts`) — consumed by Task 6 (`_layout.tsx`)

- [ ] **Step 1: Write the failing tests for `auth-context.tsx`**

`mobile/src/lib/auth-context.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import * as api from "./api";
import { AuthProvider, useAuth } from "./auth-context";
import * as sessionStorage from "./session-storage";
import type { Session } from "./types";

jest.mock("./api");
jest.mock("./session-storage");

const mockedApi = jest.mocked(api);
const mockedSessionStorage = jest.mocked(sessionStorage);

const SESSION: Session = {
  accessToken: "token",
  user: { googleId: "1", email: "a@b.com", name: "A" },
};

function wrapper({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthProvider / useAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts loading, then signedOut when there is no stored session", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("signedOut"));
  });

  it("restores a signedIn state from a stored session", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("signedIn"));
    expect(result.current).toMatchObject(SESSION);
  });

  it("signIn calls the API, persists the session, and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(null);
    mockedApi.postGoogleLogin.mockResolvedValue(SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedOut"));

    await act(async () => {
      await result.current.signIn("id-token");
    });

    expect(mockedApi.postGoogleLogin).toHaveBeenCalledWith("id-token");
    expect(mockedSessionStorage.saveSession).toHaveBeenCalledWith(SESSION);
    expect(result.current.status).toBe("signedIn");
  });

  it("signOut clears the session and updates state", async () => {
    mockedSessionStorage.getSession.mockResolvedValue(SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signedIn"));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockedSessionStorage.clearSession).toHaveBeenCalled();
    expect(result.current.status).toBe("signedOut");
  });

  it("throws when useAuth is called outside AuthProvider", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider",
    );

    consoleError.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- auth-context.test`
Expected: FAIL — `Cannot find module './auth-context'`

- [ ] **Step 3: Implement `auth-context.tsx`**

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

import { postGoogleLogin } from "./api";
import { clearSession, getSession, saveSession } from "./session-storage";
import type { GoogleUserInfo } from "./types";

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; accessToken: string; user: GoogleUserInfo };

interface AuthContextValue extends AuthState {
  signIn: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    getSession().then((session) => {
      if (!isMounted) {
        return;
      }
      setState(session ? { status: "signedIn", ...session } : { status: "signedOut" });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async (idToken: string) => {
    const session = await postGoogleLogin(idToken);
    await saveSession(session);
    setState({ status: "signedIn", ...session });
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setState({ status: "signedOut" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- auth-context.test`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test for `google-signin.ts`**

`mobile/src/lib/google-signin.test.ts`:

```ts
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { configureGoogleSignin } from "./google-signin";

jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { configure: jest.fn() },
}));

const mockedGoogleSignin = jest.mocked(GoogleSignin);

describe("configureGoogleSignin", () => {
  const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = originalClientId;
    jest.clearAllMocks();
  });

  it("configures GoogleSignin with the webClientId from env", () => {
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = "test-client-id";

    configureGoogleSignin();

    expect(mockedGoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: "test-client-id",
    });
  });

  it("throws when EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured", () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    expect(() => configureGoogleSignin()).toThrow(
      "EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured",
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- google-signin.test`
Expected: FAIL — `Cannot find module './google-signin'`

- [ ] **Step 7: Implement `google-signin.ts`**

```ts
import { GoogleSignin } from "@react-native-google-signin/google-signin";

export function configureGoogleSignin(): void {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
  if (!webClientId) {
    throw new Error("EXPO_PUBLIC_GOOGLE_CLIENT_ID is not configured");
  }

  GoogleSignin.configure({ webClientId });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- google-signin.test`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add mobile/src/lib/auth-context.tsx mobile/src/lib/auth-context.test.tsx mobile/src/lib/google-signin.ts mobile/src/lib/google-signin.test.ts
git commit -m "feat(mobile): add AuthProvider/useAuth and Google Sign-In configuration"
```

---

### Task 5: Login screen

**Files:**
- Create: `mobile/src/app/login.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `signIn(idToken: string): Promise<void>` (`@/lib/auth-context`, Task 4)

- [ ] **Step 1: Implement `login.tsx`**

```tsx
import { useState, type JSX } from "react";
import { Image, View } from "react-native";
import { Button, Spinner, Typography, useToast } from "heroui-native";
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import { useAuth } from "@/lib/auth-context";

export default function LoginScreen(): JSX.Element {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function handlePress(): Promise<void> {
    setIsSigningIn(true);
    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return;
      }

      const { idToken } = response.data;
      if (!idToken) {
        throw new Error("Google did not return an idToken");
      }

      await signIn(idToken);
    } catch (error) {
      const wasCancelled =
        isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED;
      if (!wasCancelled) {
        toast.show("Não foi possível entrar, tente de novo.");
      }
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <View className="flex-1 bg-background items-center justify-center gap-8 px-6">
      <Image source={require("@/assets/images/icon.png")} className="w-24 h-24" />
      <Typography.Heading type="h3">UFBA</Typography.Heading>
      <Button
        className="w-full"
        isDisabled={isSigningIn}
        isIconOnly={isSigningIn}
        onPress={handlePress}
      >
        {isSigningIn ? <Spinner /> : "Entrar com Google"}
      </Button>
    </View>
  );
}
```

No automated test for this file — it's a thin composition of `GoogleSignin` (native module) and `useAuth`, both already covered; end-to-end behavior is verified manually in Task 7.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: no errors. (This will still fail to fully resolve `@react-native-google-signin/google-signin` types until Task 1's install ran — confirm Task 1 is done first.)

- [ ] **Step 3: Commit**

```bash
git add mobile/src/app/login.tsx
git commit -m "feat(mobile): add Google Sign-In login screen"
```

---

### Task 6: Root layout auth gate

**Files:**
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: `AuthProvider`, `useAuth()` (`@/lib/auth-context`, Task 4), `configureGoogleSignin()` (`@/lib/google-signin`, Task 4), `login.tsx` route (Task 5), existing `(tabs)` route.

- [ ] **Step 1: Rewrite `_layout.tsx`**

```tsx
import type { JSX } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { configureGoogleSignin } from "@/lib/google-signin";

import "../global.css";

configureGoogleSignin();

function RootNavigator(): JSX.Element | null {
  const auth = useAuth();

  if (auth.status === "loading") {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={auth.status === "signedIn"}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={auth.status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
        <StatusBar style="auto" />
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (from `mobile/`)
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test` (from `mobile/`)
Expected: PASS — all tests from Tasks 2–4 still green (this task doesn't add new unit tests; the gate itself is verified manually in Task 7 since it depends on native `GoogleSignin` behavior).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/_layout.tsx
git commit -m "feat(mobile): gate (tabs) behind auth, route to login when signed out"
```

---

### Task 7: Manual end-to-end verification (Android)

No new source files — this task wires up the last manual/Console pieces and confirms the whole flow works on a real device or emulator.

- [ ] **Step 1: Start the backend**

From `backend/`:

```bash
docker compose up -d
npm run start:dev
```

Confirm it's listening on the port in `backend/.env` (`PORT`, default `3000`) and reachable from your phone: `curl http://<your-lan-ip>:3000` from another machine on the same network, or just proceed to Step 4 and check the mobile app's network tab/logs.

- [ ] **Step 2: Get the dev build's Android debug SHA-1 fingerprint**

From `mobile/android/` (generated in Task 1):

```bash
./gradlew signingReport
```

Look for the `debug` variant's `SHA1` line.

- [ ] **Step 3: Register an Android OAuth client in Google Cloud Console**

In the same Google Cloud project as the existing Web client (`console.cloud.google.com` → APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: Android):
- Package name: `com.ufba.app` (from Task 1's `app.json`)
- SHA-1 certificate fingerprint: from Step 2

This is required for `GoogleSignin` to authenticate at all on Android (`DEVELOPER_ERROR` / status code 10 otherwise) — it doesn't change what value goes into `GoogleSignin.configure()` (still the Web client ID), it's a separate registration Google uses to verify the calling app.

- [ ] **Step 4: Build and run the dev client on Android**

From `mobile/`:

```bash
npx expo run:android
```

This builds the native app (using the `android/` project from Task 1, now including the `@react-native-google-signin/google-signin` native module) and installs it on a connected device or running emulator, then starts Metro.

Expected: app launches showing the login screen (no stored session yet).

- [ ] **Step 5: Test the full login round trip**

On the device: tap "Entrar com Google", complete the native Google account picker, confirm the app lands on the `(tabs)` Home screen.

Then verify persistence: force-close the app and reopen it — expect it to land directly on `(tabs)` without showing the login screen again (session restored from `expo-secure-store`).

- [ ] **Step 6: Test the cancel and failure paths**

- Tap "Entrar com Google", dismiss the Google account picker without choosing an account: expect to land back on the login screen with no error toast.
- Temporarily stop the backend (`Ctrl+C` on `npm run start:dev`) and try signing in again: expect the "Não foi possível entrar, tente de novo." toast, then restart the backend and confirm signing in succeeds normally.

No commit for this task — it's verification of Tasks 1–6, not new code. If any step fails, fix the relevant task's code/config and re-run from Step 4.
