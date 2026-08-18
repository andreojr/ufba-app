# SIGAA credential link screen — design spec

## Motivation

To fetch schedule/grades, Gradline needs the student's SIGAA login and
password (SIGAA has no OAuth/SSO — confirmed in
`docs/superpowers/spikes/2026-08-17-sigaa-investigation.md`). The
backend already has the storage side of this built: `SigaaLink`
(Prisma), AES-256-GCM encryption (`credential-vault.ts`), and an
audit-logged decrypt path, gated by an opt-in `rememberPassword` flag
on `POST /sigaa/link`.

What's missing is the mobile-side screen that collects the credential
and exposes the "save to cloud" choice to the user, plus the ability
to restore a cloud-saved credential on a new device/reinstall so that
choice pays off for the user.

## Scope

In scope:
- One new mobile screen (`sigaa-link.tsx`) collecting SIGAA `login` +
  `senha`, with an opt-in checkbox for cloud persistence.
- A new backend read endpoint (`GET /sigaa/link`) to restore a
  previously cloud-saved credential onto a new device.
- Local device storage of the credential (via `expo-secure-store`),
  independent of the cloud choice, so the app can call
  `GET /schedule` (which takes credentials per-request) without
  re-prompting.

Out of scope (explicitly deferred):
- Any background sync job / push notifications using the stored
  credential. `GET /schedule` continues to require credentials in the
  request body; no "fetch using stored credential" endpoint is added
  for schedule/grades fetching itself.
- iOS (mobile Google login is Android-only for now per the existing
  login spec; this screen follows the same constraint).
- Editing/re-linking a SIGAA credential once linked (no "forget my
  password" UI in this pass — deferred).

## Architecture

A new screen sits between Google sign-in and the app's tabs. It only
appears for a signed-in user who has no SIGAA credential available
locally. "Available locally" — not a backend flag — is the gate,
because the provider first tries to restore from the cloud before
deciding to show the form.

Mirrors the existing `AuthProvider`/`useAuth` pattern already used for
Google sign-in.

## Components

### Backend (new)

- `SigaaLinkController.getLink()` — `GET /sigaa/link`, guarded by
  `JwtAuthGuard`, resolves `userId` via `@CurrentUser()`.
- `SigaaLinkService.getLinkedCredentials(userId)` — looks up
  `SigaaLink` by `userId`. Not found → `{ linked: false }`. Found →
  decrypts via the existing `credential-vault.ts` (this call goes
  through the same `AuditLogger` as every other decrypt, reason
  `"mobile-restore"`), returns `{ linked: true, login, senha }`.

### Mobile (new)

- `mobile/src/lib/sigaa-storage.ts` — mirrors
  `session-storage.ts`: `getSigaaCredentials()` /
  `saveSigaaCredentials(creds)` / `clearSigaaCredentials()`, backed by
  `expo-secure-store` under its own key (`"gradline.sigaa"`).
- `mobile/src/lib/api.ts` (additions):
  - `postSigaaLink(accessToken, { login, senha }, rememberPassword): Promise<void>`
    — `POST /sigaa/link` with `Authorization: Bearer ${accessToken}`.
  - `getSigaaLink(accessToken): Promise<{ linked: false } | { linked: true; login: string; senha: string }>`
    — `GET /sigaa/link` with the same auth header.
  - Both follow the existing `ApiError`/10s-timeout/JSON conventions
    in `api.ts`.
- `mobile/src/lib/sigaa-link-context.tsx` — `SigaaLinkProvider` /
  `useSigaaLink()`. State: `{status: "loading" | "linked" | "unlinked"}`.
  On mount (once `useAuth()` is `signedIn`): checks local storage
  first; if empty, calls `getSigaaLink`; on `linked: true` saves the
  returned credential locally and sets `status: "linked"`; on
  `linked: false` (or on network failure) sets `status: "unlinked"`.
  Exposes `link(login, senha, rememberPassword)`, which calls
  `postSigaaLink`, then always saves `{login, senha}` locally on
  success, then sets `status: "linked"`.
- `mobile/src/app/sigaa-link.tsx` — the form. Fields: `login` (text),
  `senha` (secure text entry), a checkbox "Guardar minha senha do
  SIGAA na nuvem" (unchecked by default — privacy-preserving default),
  submit button with the same disabled/spinner pattern as
  `login.tsx`. On submit calls `useSigaaLink().link(...)`; failures
  surface via `useToast()`, matching `login.tsx`'s error handling.
- `mobile/src/app/_layout.tsx` — `RootNavigator` gains a second
  provider (`SigaaLinkProvider`, nested inside `AuthProvider` since it
  needs `useAuth()`'s `accessToken`) and a third `Stack.Protected`
  guard: `signedIn && status === "unlinked"` → `sigaa-link`;
  `signedIn && status === "linked"` → `(tabs)`; any `loading` state
  (auth or sigaa-link) → renders `null`, same as today.

## Data flow

```
Google sign-in ok
  → AuthProvider: signedIn
  → SigaaLinkProvider mounts: checks SecureStore locally
      found      → status: linked → (tabs)
      not found  → GET /sigaa/link
          linked: false → status: unlinked → shows sigaa-link.tsx
          linked: true  → saves credential locally → status: linked → (tabs)

User fills sigaa-link.tsx and submits
  → POST /sigaa/link { login, senha, rememberPassword }
      backend performs a real SIGAA login to validate the credential
      rememberPassword ? persists encrypted (SigaaLink) : deletes any existing stored copy
  → success: saves { login, senha } to local SecureStore (always) → status: linked → (tabs)
  → failure (invalid credential / network): toast error, stays on screen
```

## API contracts

`POST /sigaa/link` (existing, unchanged):
- Request: `{ login: string; senha: string; rememberPassword?: boolean }`
- Response: `{ linked: true }`
- Auth: `Authorization: Bearer <jwt>`

`GET /sigaa/link` (new):
- Request: none (userId from JWT)
- Response: `{ linked: false } | { linked: true; login: string; senha: string }`
- Auth: `Authorization: Bearer <jwt>`

## Error handling

- Empty `login`/`senha` fields → submit button disabled (inline
  validation), no toast.
- `POST /sigaa/link` failure (SIGAA rejects the credential, or
  network/timeout) → toast: "Não foi possível validar seu login do
  SIGAA. Confira usuário e senha." — same toast pattern as
  `login.tsx`. User stays on the form.
- `GET /sigaa/link` failure on restore (network error) → treated as
  `unlinked` silently (`console.warn`, no toast) — worst case the user
  re-enters credentials they'd already saved to the cloud, which is
  recoverable and non-blocking.
- Local `saveSigaaCredentials` failure after a successful backend call
  → `console.warn`, flow proceeds to `linked` anyway — the backend
  already has the validated/persisted state; the only consequence is
  the user might be re-prompted on this device later.

## Security considerations

- This does not change the transmission trust model already accepted
  for the existing `sigaa-engine`: the SIGAA password transits to the
  Gradline backend on every `/sigaa/link` and `/schedule` call
  regardless of the cloud checkbox, because the SIGAA scrape itself
  runs server-side. The checkbox controls only *persistence*
  (whether a durable encrypted copy exists after the request
  completes), not transmission.
- `GET /sigaa/link` decrypts and returns the credential in plaintext
  over TLS to the credential's own owner (authenticated via JWT) —
  this is not new exposure beyond what the user already entered; it
  reuses the existing audit-logged decrypt path so every decrypt,
  including this one, remains traceable.
- Default checkbox state is unchecked (no cloud persistence) —
  favors the more private option by default.

## Testing

Co-located `*.test.ts(x)` files, matching the existing convention:
- `sigaa-storage.test.ts` — get/save/clear; corrupted JSON → `null`.
- `api.test.ts` (extended) — `postSigaaLink`/`getSigaaLink`: success,
  HTTP error, timeout.
- `sigaa-link-context.test.tsx` — local-first hydration, fallback to
  `GET /sigaa/link`, all state transitions.
- `sigaa-link.test.tsx` — form validation, submit with checkbox
  checked/unchecked, error toast on failure.
- Backend: `SigaaLinkService.getLinkedCredentials` (found/not-found
  branches), `GET /sigaa/link` controller (guard rejects unauthed,
  decrypted response shape, audit log invoked on decrypt).
