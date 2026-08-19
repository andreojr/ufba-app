# Trajetória screen — design spec

## Motivation

`mobile/src/app/(tabs)/trajetoria.tsx` is the last fully-mocked screen
in the app: periods, grades, coefficient, progress bar and the pending
course planner all read from `mock-data.ts`. Everything it needs lives
in one document — the SIGAA "Histórico Escolar" PDF — which the backend
already knows how to download (`SigaaEngineService.fetchHistorico`,
classic portal-menu flow, see `HISTORICO_PDF_INVESTIGATION.md`). What's
missing is turning those bytes into data.

The spike in
`docs/superpowers/spikes/2026-08-19-historico-pdf-parser.md` settled
feasibility against a real transcript: the PDF carries a real text
layer, and a prototype parsed 49/49 completed components and 20/20
pending ones, recalculating the CR to an exact match with the value
printed in the header. Read that document first — this spec assumes its
findings (column geometry, section anchors, which fields exist and
which don't) rather than restating them.

The fetch strategy is the other half of the motivation. The transcript
costs the same ~7 sequential SIGAA requests as a document download
(45s client timeout, see `api.ts`), and its content only changes when a
term's grades are consolidated. Fetching it on every screen open — the
way `/schedule` works today — would be wrong on both counts. So the
parsed result is persisted server-side and the screen reads from our
own database.

## Scope

In scope:

- Two new backend parsers: PDF text extraction (positioned items) and
  a pure transcript parser.
- Persistence of the parsed transcript as a per-user snapshot, plus a
  user-authored planning table that survives re-syncs.
- Two endpoints: `POST /trajetoria/sync` and `GET /trajetoria`.
- Mobile: replacing the mock data on the Trajetória screen, an
  unsynced fallback state, a manual sync affordance, and a staleness
  hint.

Out of scope (explicitly deferred):

- **The semester cron.** The eventual design — once a term ends, a
  daily job re-checks the transcript until every `MATR` component has
  become concluded, then stops — is not built here. The schema is
  shaped so it needs no migration to add: `fetchedAt`,
  `periodoLetivoAtual`, the conclusion deadlines and the `MATR` rows
  are all persisted. Note it will only ever cover users on
  `syncMode: "cloud"`, since the server needs a credential to
  re-scrape.
- **Enumerating pending optativas.** The transcript names only
  *obligatory* pending components; optativas appear solely as an
  aggregate (`360 h` in the sample). This is not a parser limitation —
  the university genuinely does not prescribe which optativas a
  student takes. In this pass those hours count toward the progress
  bar and nothing else. The future feature (search a catalogue of all
  components and add a chosen optativa to your own trajectory) is why
  `plano_item` is not a foreign key onto pending rows.
- **Frequency per component.** It does not exist in the document.
  `REPF`/`REPMF` are the only encoding of failure-by-absence.
- Any use of the `IAP` index beyond storing and displaying it. Its
  formula was not reverse-engineered; it arrives pre-computed.

## Architecture

Four layers, each testable on its own.

**Extraction** isolates the only new dependency. `pdf-parse@^2.4.5`
(pure JS, CJS entry, no native binary) exposes pdfjs's
`PDFDocumentProxy`, from which `getTextContent()` yields every text
item with its `transform` matrix and font name. Flat text extraction —
from any library — is unusable here: iText paints in an order that
dissociates labels from values, so the layer works from x/y geometry
instead.

**Parsing** is a pure synchronous function over those items. No I/O, no
PDF, no async — which is what makes the interesting cases (a component
row with no natureza, a component with no docente, the same code in two
semesters) cheap to test from a JSON fixture.

**Orchestration** composes the existing download with the new parsing
and persistence, in that order, and refuses to persist anything that
fails validation.

**Persistence** follows the token + factory pattern already in
`db/database.module.ts`: a `HISTORICO_REPOSITORY` symbol in
`db/tokens.ts`, a `PrismaHistoricoRepository` behind an interface owned
by the domain side.

The HTTP naming keeps *document* and *view* apart: the parsers speak
`historico` (the PDF), the resource speaks `trajetoria` (what the
screen needs — transcript and plan in a single round trip).

## Components

### Backend (new)

- `sigaa-engine/parsers/historico-texto.ts` — the only file importing
  `pdf-parse`. `extrairItensHistorico(pdf: Buffer): Promise<ItemTexto[]>`,
  where `ItemTexto` is `{ pagina, x, y, texto, fontName }`.

  Note on font: pdfjs cannot tell us which font is the oblique one
  here. The transcript's fonts are not embedded, so
  `getTextContent().styles` reports `fontFamily: "sans-serif"` for all
  three, and the only distinguishing handle is a per-document generated
  id (`g_d0_f3`) that must not be hardcoded. Verified against the real
  document. The parser therefore identifies a docente line by shape,
  not by font — see below. `fontName` is carried on `ItemTexto` for
  debugging and fixture inspection only; no parsing decision may depend
  on its value.

- `sigaa-engine/parsers/historico.ts` —
  `parseHistorico(itens: ItemTexto[]): Historico`, pure and
  synchronous. Delimits sections by text anchors (never by page
  position — the legend spills onto the last page and the footer's y
  shifts). Inside the component table, any item matching `^\d{4}\.\d$`
  at x < 60 is a row baseline; cells are sliced by x band with
  tolerance, since columns drift ~3 pt between pages.

  A component row's second line — the one sitting 1 to 8 pt below the
  baseline inside the name column — is the **docente** when its joined
  text ends in `(Nh)`, and a **continuation of the component name**
  otherwise. Verified against the real document: this agrees with
  font-based classification on all 49 rows (48 docente lines, zero
  disagreements), needs no font information, and handles a wrapped
  component name — the fragility the spike flagged as unobserved but
  likely — with no extra rule.

  Types: `SituacaoComponente` (`APR | CANC | DISP | MATR | REP | REPF
  | REPMF | TRANC | TRANS | INCORP | CUMP`, the full legend, not just
  the four the sample happens to contain), `NaturezaComponente`
  (`OB | OP | EB | EP | LV | EC`), `ComponenteCursado`,
  `ComponentePendente`, `ResumoCargaHoraria`, `Historico`.

  Deliberately not extracted: CPF, RG, date and place of birth. The
  matrícula is already on `User`; the rest is sensitive data no screen
  uses.

- `sigaa-engine/historico.service.ts` —
  - `sync(userId, credenciais)`: `fetchHistorico` → extract → parse →
    validate → persist in one transaction → return the aggregate.
  - `getTrajetoria(userId)`: reads the snapshot and the plan, returns
    the aggregate or `null` when the user has never synced.

- `db/prisma-historico.repository.ts` +
  `HISTORICO_REPOSITORY` in `db/tokens.ts`, wired in
  `db/database.module.ts` by the same factory pattern as the three
  existing repositories.

- `sigaa-engine/trajetoria.controller.ts` — a controller of its own
  rather than two more routes on `SigaaController`, which is already
  carrying six:
  - `POST /trajetoria/sync` — `JwtAuthGuard`, `@CurrentUser()`,
    `SigaaCredentialsDto` body. Same credentials-in-body convention as
    `/schedule` and `/sigaa/historico`.
  - `GET /trajetoria` — `JwtAuthGuard`, `@CurrentUser()`, no body.

### Mobile

- `lib/api.ts` — `postTrajetoriaSync(accessToken, credentials)` using
  `SIGAA_DOCUMENT_TIMEOUT_MS` (the 10s default aborts mid-scrape), and
  `getTrajetoria(accessToken)`.
- `lib/trajetoria.ts` — the derivations listed below, as pure
  functions with their own tests.
- `app/(tabs)/trajetoria.tsx` — mock imports replaced by fetched data,
  plus the unsynced / loading / error states.

`mock-data.ts` keeps only what other screens still use.

## Data model

Three snapshot tables, wiped and reinserted inside one transaction on
every sync. The PDF *is* the complete state, so row-by-row upsert would
leave behind components dropped by an enrolment change.

- **`historico`** — one row per user (`userId` as primary key).
  `emitidoEm`, `codigoVerificacao`, `curriculo`,
  `periodoLetivoAtual`, `prazoPadrao`, `prazoMaximo`,
  `cr` / `iap` as `Decimal(6,4)`, the twelve integers of the workload
  matrix (exigida / integralizada / pendente × obrigatórias /
  optativas / complementares / total), and `fetchedAt`.

  The `total` column is derivable from the other three, but persisting
  what the document asserts is what makes a future mismatch
  detectable.

- **`historico_componente`** — `@@unique([historicoId, semestre, codigo])`.
  The semestre belongs in the natural key: the same code legitimately
  recurs across terms (the sample has one component as `TRANC` in
  2024.1 and `REP` in 2024.2). `natureza` is nullable — on `TRANC`
  rows the column emits no item at all. `nota` is
  `Decimal(3,1)`, nullable (`--` for `TRANC` and `MATR`). `docente` is
  nullable and stored raw, capitalisation included.

- **`historico_pendente`** — `@@unique([historicoId, codigo, nome])`.
  The nome is in the key because `ENADE` appears twice under different
  names. `matriculado: Boolean` carries the "Matriculado" annotation.

`situacao` and `natureza` are stored as `String`, not Prisma enums: the
legend can gain values in a SIGAA migration, and an enum would turn
that into an insert failure instead of a row we can still show. The
TypeScript types constrain the parser, which is where it matters.

One authored table, which **must survive the sync**:

- **`plano_item`** — `userId`, `codigo`, `nome`, `cargaHoraria`,
  `semestre` (`"2026.2"`, or null for the unplanned pool),
  `@@unique([userId, codigo])`.

  `nome` and `cargaHoraria` are denormalised copies of the pending
  row's, for the same reason the table exists: a plan item has to stay
  renderable across a snapshot replacement, and a future authored
  optativa will have no pending row to read them from.

  `codigo` is a loose reference, deliberately **not** a foreign key
  onto `historico_pendente`. A foreign key would cascade the user's
  planning away every time the snapshot is replaced. Instead, `sync`
  reconciles: a plan item whose code no longer appears among the
  pending components has been completed, and is removed. This is also
  what lets a future chosen optativa live in the plan with no pending
  row to point at.

## Data flow

1. The screen mounts and calls `GET /trajetoria`.
2. Never synced → the endpoint says so, and the screen renders the
   **fallback state**: an explanation and a "Sincronizar histórico"
   button.
3. The button calls `POST /trajetoria/sync` with the credential from
   `expo-secure-store`, the same way the home screen feeds
   `postSchedule`. The wait is long enough to need feedback — reuse
   `lib/download-progress.ts`.
4. `sync` returns the freshly built aggregate, so the screen renders
   without a second round trip.
5. Afterwards, pull-to-refresh calls the same sync. In this pass it is
   the only trigger.

**The sync affordance is permanent, not a v1 bootstrap.** For users on
`syncMode: "device"` the server can never hold a credential, so no
cron will ever cover them; the button stays their primary path and is
never gated on `syncMode`. For cloud users it remains the escape hatch
when a job fails or they want to force a refresh.

That asymmetry is why `fetchedAt` is part of the `GET /trajetoria`
payload and visible on screen. Once cloud users get silent updates, a
device user with no freshness signal is the worst case — stale data
with no way to notice. The screen shows when it last synced, and
derives a nudge client-side with no server credential involved: if the
term's end date (already returned by `/schedule` as `periodoLetivo`)
has passed and `fetchedAt` predates it, the transcript may be out of
date and the screen says so.

## Derivations

What the screen computes rather than reads:

- **Progress percentage** — `integralizada.total / exigida.total`. Not
  in the document. The denominator already includes optativa and
  complementary hours, which is exactly how those hours "count" in
  this pass.
- **Periods** — group component rows by `semestre`.
- **Concluded vs. in progress** — a semestre holding any `MATR` row is
  the current one. Cross-checks against `periodoLetivoAtual`.
- **Grade display** — the document uses a decimal point and one
  decimal place; the comma is a formatting concern, applied at render.
- **Remaining components** — the count of pending rows, excluding
  `ENADE` (not a curricular component) and, for the planner pool,
  those already flagged `matriculado`.
- **Planning horizon** — semesters after the current one, bounded by
  the conclusion deadlines the document provides.

## Error handling

The parser checks three invariants the document supplies for free:

1. The CH sum of `APR` (and `EB`) rows equals the workload matrix's
   `Integralizado / Total`.
2. The CR recomputed as `Σ(nota × CH) / Σ CH` over rows carrying a
   grade — `APR` and `REP`; `TRANC` and `MATR` excluded from both
   numerator and denominator — equals the header's `CR` within 0.0001.
3. The pending row count equals the count in the section title.

A mismatch **throws, and nothing is persisted**: the previous snapshot
stays intact and the client gets a descriptive error. This follows
`fetchHistorico`, which already prefers a descriptive failure (with the
leading bytes) over handing back something that is not a PDF. The same
applies to a missing section anchor — a transcript shape we do not
recognise must fail loudly rather than persist a partial trajectory
that looks plausible.

## Security and privacy

- CPF, RG, and date/place of birth are read past, never extracted and
  never stored.
- Storing academic data server-side follows the existing precedent:
  `updateSigaaProfile` already persists matrícula, curso and período de
  ingresso for every user. `syncMode` governs the *password*, not
  academic data.
- The real transcript PDF does not enter the repository, in any form —
  see Testing.

## Testing

TDD, parser first. Co-located specs, one behaviour per `it`, matching
the existing convention.

- **Fixture**: `parsers/__fixtures__/historico-itens.json`, a dump of
  the real transcript's `ItemTexto[]`, **anonymised before it is
  committed** — name, matrícula, CPF, RG, birth date and verification
  code replaced with fictional values. Only the `texto` fields change;
  the x/y coordinates the parser depends on are independent of content.

  The real PDF is not committed, not even anonymised: reliably
  anonymising a PDF binary is fragile.

- `parsers/historico.spec.ts` over that fixture — the row count; a
  `TRANC` row with no natureza; a component with no docente; the same
  code present twice under different semesters and situações; `--`
  parsed as null; pending rows with the correct `matriculado` flag;
  the workload matrix; equivalências and observações; and one spec per
  invariant, asserting it throws on a doctored fixture.

- `parsers/historico-texto.spec.ts` — a synthetic one-page PDF with
  fictional text, covering only the `pdf-parse` → `ItemTexto` bridge.

- `historico.service.spec.ts` — the happy path persists in one
  transaction; a parser throw persists nothing; plan reconciliation
  drops an item whose code is no longer pending and keeps one that
  still is.

- Controller specs — unauthenticated requests rejected, `GET` before
  any sync reports the unsynced state, response shape.

- Mobile — `api.test.ts` extended (success, HTTP error, timeout);
  `trajetoria.ts` derivation tests; `trajetoria.test.tsx` for the
  fallback, loading, error and populated states, and the staleness
  hint firing only when the term has ended and `fetchedAt` predates
  it.

## Situação on a component row

The mock shows code, name and grade only. The real document also
carries situação, so a `4.0` that was failed currently renders
identically to a `4.0` that was passed.

The default this spec commits to, so implementation is not blocked on a
design pass: `APR` stays as it renders today (grade only, coloured by
the existing `gradeColor`); every other situação gets a small chip next
to the grade with a Portuguese label — "reprovado", "reprovado por
falta", "trancado", "dispensado", "em curso". A `MATR` row already
shows `—` in place of a grade, so its chip carries the whole signal.

This is a reasonable default, not a settled visual design — worth
revisiting against Figma once the real data is on screen.

## Implementation order

The spec is one vertical feature, but it splits cleanly into three
stages that can each be verified on their own:

1. **Parsers** — extraction and `parseHistorico` against the
   anonymised fixture, including every invariant. Nothing else depends
   on a decision made here, and it is where the risk is.
2. **Persistence and endpoints** — schema, migration, repository,
   service, controller, plan reconciliation.
3. **Screen** — API client, derivations, states, situação chips.
