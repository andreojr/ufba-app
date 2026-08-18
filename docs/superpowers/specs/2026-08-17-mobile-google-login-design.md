# Mobile Google Login — Design

## Context

The Gradline backend (`backend/src/auth`) already exposes `POST /auth/google`,
which accepts `{ idToken: string }`, verifies it against `GOOGLE_CLIENT_ID`
(a Google Web OAuth client), and returns:

```ts
{ accessToken: string; user: { googleId: string; email: string; name: string } }
```

Google Sign-In is Gradline's only auth method (see `backend/.env.example`) —
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

Use `expo-auth-session` for the Google OAuth flow — it runs inside Expo Go
(no custom dev client / EAS build needed), which matches how this app is
currently tested (physical device over LAN, per recent commits). The
alternative, `@react-native-google-signin/google-signin`, gives a more
native-feeling bottom sheet but requires a custom dev client and was
rejected to avoid that friction at this stage.

The existing `GOOGLE_CLIENT_ID` (Web application type) already configured
in `backend/.env` is reused as the `expoClientId` for the mobile OAuth
request. This requires adding the Expo Go proxy redirect URI
(`https://auth.expo.io/@<expo-username>/mobile`) to that same OAuth client's
authorized redirect URIs in Google Cloud Console — a manual step for the
user, not automated here.

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
renders nothing (or the existing splash, if trivial to keep mounted).
Once resolved:
- `signedOut` → `Stack` renders `login`, `(tabs)` is unreachable (redirect
  away if the user is deep-linked into it).
- `signedIn` → `Stack` renders `(tabs)`, `login` is unreachable the same
  way.

This follows Expo Router's documented redirect-based protected-routes
pattern; no third-party navigation guard library.

### `login.tsx`

Single screen: Gradline logo (`design/logo/gradline-icon.svg`), a HeroUI
Native `Button` labeled "Entrar com Google", and a `Spinner`/disabled state
while the OAuth + backend round-trip is in flight. On success, the routing
gate above handles navigation — the screen itself doesn't call
`router.replace`.

## Configuration

New env vars, mobile side (`mobile/.env` consumed by Expo's built-in
`EXPO_PUBLIC_*` support — no extra config library needed):

- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` — same value as backend's `GOOGLE_CLIENT_ID`.
- `EXPO_PUBLIC_API_URL` — backend base URL reachable from the physical
  device (LAN IP, e.g. `http://192.168.x.x:3000`), not `localhost`.

Manual step (user, in Google Cloud Console, on the existing Web OAuth
client): add `https://auth.expo.io/@<expo-username>/mobile` as an
authorized redirect URI.

## Error Handling

- User cancels/dismisses the Google OAuth prompt: return to the login
  screen's default state, no error toast.
- Backend rejects the token, or the network request fails: show a generic
  HeroUI Native `Toast` ("Não foi possível entrar, tente de novo") and
  return to the default button state. No need to distinguish causes yet —
  the backend doesn't return machine-readable error codes for this path
  today.
- Any authenticated request elsewhere in the app that gets a `401`: clear
  the session and let the routing gate send the user back to `login`. No
  refresh-token flow exists to attempt first.

## Testing

- Unit tests for `session-storage.ts` (mocking `expo-secure-store`) and
  `auth-context.tsx` (mocking `api.ts` and `session-storage.ts`) covering:
  restoring an existing session on mount, successful sign-in, sign-in
  failure, sign-out.
- No E2E/integration test in this pass — verification is manual, running
  the app in Expo Go over LAN, matching current project practice.

## Explicitly out of scope

- Any screen between login success and `(tabs)`.
- Refresh tokens / silent re-auth.
- `@react-native-google-signin/google-signin` / native dev client build.
- Any backend change.
