# UFBA backend

NestJS backend for UFBA — replaces the SIGAA (UFBA) web UI with a modern API for the mobile app.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `GOOGLE_CLIENT_ID` — from the Google Cloud Console. **You need to create this yourself** (OAuth consent screen + OAuth client ID, application type **Web application** — that's what `google-auth-library` checks as the token audience, even though the client app is mobile) — see the comments in `.env.example` for the exact steps. Not automated here.
- `JWT_SECRET` — `openssl rand -base64 48`
- `SIGAA_CREDENTIAL_ENC_KEY` — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `DATABASE_URL` — Postgres connection string. For local dev without touching any other project's database, spin up a dedicated container:
  ```bash
  docker compose up -d   # postgres:16-alpine on localhost:5436, isolated from other local containers
  ```

Apply the schema (Prisma, not raw SQL — `prisma/schema.prisma` is the source of truth):

```bash
npx prisma migrate dev
```

Run:

```bash
npm run start:dev
```

Test:

```bash
npm test
```

## Architecture

Two separate auth domains, deliberately kept apart:

- **UFBA auth** — Google Sign-In only. The app sends a Google ID token to `POST /auth/google`; the backend verifies it (`google-auth-library`) and issues its own JWT (`src/auth/`).
- **SIGAA credential** — used only by the sigaa-engine to scrape the portal on the user's behalf. **Never persisted by default**: it travels in the request body on every call and is discarded from memory once used. Only if the user opts into "lembrar senha" (`rememberPassword: true` on `POST /sigaa/link`) is it encrypted (AES-256-GCM, key from `SIGAA_CREDENTIAL_ENC_KEY`, never in the DB) and stored — every decryption is written to `audit_log`.

### Database (`prisma/`, `src/db/`)

ORM is **Prisma** (`prisma/schema.prisma` defines `User`, `SigaaLink`, `AuditLog`, `CachedGrade`, `CachedSchedule` — table/column names kept snake_case via `@@map`/`@map` for readability in `psql`). `src/db/prisma.service.ts` wraps `PrismaClient` as a Nest provider; `prisma-sigaa-link.repository.ts` and `prisma-audit-logger.ts` implement the `SigaaLinkRepository`/`AuditLogger` interfaces the sigaa-engine depends on, so those services stay unit-testable against a fake without touching Prisma at all.

To change the schema: edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <description>`.

### sigaa-engine (`src/sigaa-engine/`)

Pure HTTP + cheerio, no headless browser — validated feasible in
[`docs/superpowers/spikes/2026-08-17-sigaa-investigation.md`](../docs/superpowers/spikes/2026-08-17-sigaa-investigation.md).

- `session.ts` — login (`POST /sigaa/logar.do?dispatch=logOn`), JSESSIONID + `javax.faces.ViewState` state machine, session-expiry detection with a single automatic relogin when a credential is remembered for that session instance.
- `http-client.ts` — real HTTP client: ISO-8859-1 decoding (SIGAA is not UTF-8), one retry with backoff on network errors/429.
- `schedule-code.ts` — pure translator for SIGAA's schedule codes (`2N34`, `35N12`, ...) into human-readable days/shift/time-ranges. See [`docs/reference/sigaa-schedule-codes.md`](../docs/reference/sigaa-schedule-codes.md).
- `parsers/turmas-horario.ts` — parses the "Minhas Turmas" table on the portal home (turmas + schedule, no extra navigation needed).
- `credential-vault.ts` — AES-256-GCM encrypt/decrypt with an audit-logged decryption path.
- `sigaa-engine.service.ts` / `sigaa-link.service.ts` — orchestration (login → fetch → parse; login-validate → optionally persist).

### Known gap

- **`parsers/boletim.ts` (grades parser) is not implemented.** The investigation never captured a real "Ver Notas" HTML sample (the semester being tested hadn't posted grades yet). `GET /grades` currently returns `501 Not Implemented` with that explanation. Do not guess the table structure — get a real fixture first (safely, without ever sharing a real password — see the safety rule below), then TDD the parser.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/google` | — | Body: `{ idToken }`. Returns `{ accessToken, user }`. |
| POST | `/sigaa/link` | UFBA JWT | Body: `{ login, senha, rememberPassword? }`. Validates live against SIGAA before storing anything. |
| GET | `/schedule` | UFBA JWT | Body: `{ login, senha }` (credentials travel per-request; not a strict REST convention for GET, but keeps them out of query strings/persistence by default). |
| GET | `/grades` | UFBA JWT | **501** — see Known gap above. |

## Safety rule

Never type, request, log, or persist a real SIGAA password in this codebase or in an agent session. Login logic is built and tested entirely against fixtures documented in the spike (`302` + `Location: paginaInicial.do` = success; `200` + `loginForm`/error message = failure). If real-world validation is ever needed again, the pattern is: prepare a script the user runs themselves in their own terminal, typing their own password, reporting back only the structural result (see `test-login.sh` at the repo root for the precedent).
