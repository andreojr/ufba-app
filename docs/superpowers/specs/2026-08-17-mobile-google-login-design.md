# Mobile Google Login — Design

## Context

The UFBA backend (`backend/src/auth`) already exposes `POST /auth/google`,
which accepts `{ idToken: string }`, verifies it against `GOOGLE_CLIENT_ID`
(a Google Web OAuth client), and returns:

```ts
{ accessToken: string; user: { googleId: string; email: string; name: string } }
```

Google Sign-In is UFBA's only auth method (see `backend/.env.example`) —
there is no email/password flow to support.

The mobile app (`mobile/`) is an Expo Router + HeroUI Native scaffold with a
single `(tabs)` group (`index`, `explore`) and no auth screen yet. This spec
covers building the first login flow: a login screen that authenticates via
Google, persists the session, and gates access to the existing `(tabs)`
group.

Out of scope: any screen between login and `(tabs)` (e.g. onboarding/profile
completion), refresh tokens (backend doesn't issue any yet), and any change
to the backend.

## Approach

**Revision note:** the original approach picked `expo-auth-session`
specifically to avoid a custom dev client / native build. That premise
turned out to be wrong — Expo's own docs are explicit that "Expo Go cannot
be used for local development and testing of OAuth or OpenID Connect-enabled
apps due to the inability to customize your app scheme," and recommend a
Development Build for any OAuth flow. Since a dev client is required either
way, we use `@react-native-google-signin/google-signin` instead — it's
Expo's own recommended library for Google specifically, uses the native
Google SDK (better UX, no hand-rolled OAuth endpoint wiring), and needs no
more native setup than the generic `expo-auth-session` route would have.

This means the app moves from "Continuous Native Generation, run via Expo
Go" to "Continuous Native Generation, run via a local dev client" — `ios/`
and `android/` stay generated (not committed; already gitignored) via
`npx expo prebuild`, but day-to-day running uses `npx expo run:android` /
`npx expo run:ios` (or an EAS dev build) instead of scanning a QR code in
Expo Go.

**Platform note:** the primary dev machine is Linux, so local native builds
are Android-only (`npx expo run:android`, requires Android SDK/emulator or
a USB-connected device). iOS needs either a Mac or an EAS cloud build — out
of scope for this pass; see "Explicitly out of scope."

`GoogleSignin.configure({ webClientId })` uses the existing Web
`GOOGLE_CLIENT_ID` (already in `backend/.env`) to request an `idToken` whose
audience matches what the backend validates — no separate Android client ID
is required to make the token verifiable server-side. Android does require
registering the app's SHA-1 fingerprint against an Android-type OAuth client
in Google Cloud Console for `GoogleSignin` to work at all (a manual Console
step, not automated here); the plan calls this out at the point it's
needed. iOS additionally needs its own OAuth client ID and an
`iosUrlScheme` plugin config — deferred along with iOS support generally.

Session state is handled via a React Context (`AuthProvider`), following
Expo Router's standard "protect routes with a root layout gate" pattern.
No extra state library (e.g. Zustand) is needed — the state is just
`{ accessToken, user, status }` plus `signIn`/`signOut`.

## Architecture

```
mobile/src/
  app/
    _layout.tsx           # root: wraps app in AuthProvider, gates login vs (tabs)
    login.tsx             # login screen, rendered when unauthenticated
    (tabs)/...             # existing, unchanged
  lib/
    auth-context.tsx      # AuthProvider + useAuth() hook
    api.ts                 # fetch wrapper: postGoogleLogin(idToken)
    session-storage.ts     # thin wrapper over expo-secure-store (get/set/clear accessToken + user)
```

### `session-storage.ts`

Wraps `expo-secure-store` with a small typed API:

```ts
getSession(): Promise<{ accessToken: string; user: GoogleUserInfo } | null>
saveSession(session: { accessToken: string; user: GoogleUserInfo }): Promise<void>
clearSession(): Promise<void>
```

Keeps SecureStore's string-only, key-based API out of the rest of the app.

### `api.ts`

```ts
postGoogleLogin(idToken: string): Promise<{ accessToken: string; user: GoogleUserInfo }>
```

Reads the backend base URL from `process.env.EXPO_PUBLIC_API_URL`. Throws a
typed `ApiError` on non-2xx responses so the UI can distinguish "backend
rejected the token" from "network unreachable" only insofar as it needs a
message to show — both currently map to the same generic toast (see Error
Handling).

### `auth-context.tsx`

`AuthProvider` owns:

```ts
type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; accessToken: string; user: GoogleUserInfo }
```

- On mount: reads `session-storage.getSession()`, transitions to
  `signedIn` or `signedOut`. This runs before first render decision so
  there's no login-screen flash for an already-authenticated user.
- `signIn(idToken)`: calls `api.postGoogleLogin`, persists via
  `session-storage.saveSession`, sets state to `signedIn`.
- `signOut()`: clears storage, sets state to `signedOut`.

Exposed via a `useAuth()` hook.

### Routing gate (`app/_layout.tsx`)

Wraps the existing `Stack` in `AuthProvider`. While `status === 'loading'`,
renders nothing. Once resolved, uses Expo Router's built-in
`<Stack.Protected guard={...}>` (the current idiomatic pattern, replacing
the older manual-redirect approach) to show exactly one of the two
screens:
- `signedOut` → `Stack.Protected guard={status === 'signedOut'}` renders
  `login`; `(tabs)` is unreachable.
- `signedIn` → `Stack.Protected guard={status === 'signedIn'}` renders
  `(tabs)`; `login` is unreachable.

No third-party navigation guard library needed.

### `login.tsx`

Single screen: the existing UFBA app icon asset
(`assets/images/icon.png`), a HeroUI Native `Button` labeled "Entrar com
Google" (swapped for a `Spinner` while signing in, via `isIconOnly` +
`isDisabled`), and a `useToast()` call on failure. On success, the routing
gate above handles navigation — the screen itself doesn't call
`router.replace`.

## Configuration

New env vars, mobile side (`mobile/.env`, consumed by Expo's built-in
`EXPO_PUBLIC_*` support — no extra config library needed):

- `EXPO_PUBLIC_API_URL` — backend base URL reachable from the physical
  device (LAN IP, e.g. `http://192.168.x.x:3000`), not `localhost`.
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` — same value as backend's `GOOGLE_CLIENT_ID`
  (a Web OAuth client ID; not a secret, but still lives in an env var
  rather than hardcoded since it has to be copied from `backend/.env`
  manually either way). Passed straight into
  `GoogleSignin.configure({ webClientId })`.

Manual step (user, in Google Cloud Console, on the project that already
has the Web client): create an **Android** OAuth client ID and register the
dev build's package name + debug SHA-1 fingerprint against it — required
for `GoogleSignin` to work on Android at all (`DEVELOPER_ERROR` / code 10
otherwise). The plan's manual-verification task walks through getting the
SHA-1 and where to paste it.

## Error Handling

- User cancels/dismisses the Google sign-in sheet
  (`response.type !== 'success'` from `GoogleSignin.signIn()`, or
  `statusCodes.SIGN_IN_CANCELLED`): return to the login screen's default
  state, no error toast.
- Backend rejects the token, the network request fails, or any other
  `GoogleSignin` error: show a generic HeroUI Native toast
  (`toast.show('Não foi possível entrar, tente de novo.')`) and return to
  the default button state. No need to distinguish causes yet — the
  backend doesn't return machine-readable error codes for this path today.
- Any authenticated request elsewhere in the app that gets a `401`: clear
  the session and let the routing gate send the user back to `login`. No
  refresh-token flow exists to attempt first.

## Testing

- Unit tests for `session-storage.ts` (mocking `expo-secure-store`) and
  `auth-context.tsx` (mocking `api.ts` and `session-storage.ts`) covering:
  restoring an existing session on mount, successful sign-in, sign-in
  failure, sign-out.
- No automated test for `login.tsx` itself or the native `GoogleSignin`
  call — verification is manual, running the dev client build on an
  Android device/emulator over LAN.

## Explicitly out of scope

- Any screen between login success and `(tabs)`.
- Refresh tokens / silent re-auth.
- iOS support (iOS OAuth client, `iosUrlScheme`, EAS/Mac build) — Android
  only for this pass.
- Any backend change.
