# Professores screen — design spec

## Motivation

Roadmap item 7. SIGAA publishes a profile page for every docente —
contact details, education, research interests, Lattes link, and the
full history of courses they have taught — and practically nobody knows
it exists. It needs no login at all. Today the app shows a student the
docente's *name* and nothing else; `Turma.docente` in
`mobile/src/lib/types.ts` even carries the comment "deliberately not
rendered anywhere yet — kept for whichever screen ends up wanting it".
This is that screen.

`PROFESSORES_INVESTIGATION.md` settled feasibility against the real
SIGAA on 2026-08-19: three plain GETs for the profile, one JSF POST to
turn a name into a `siape`, and a name match validated 4-for-4 against a
real atestado de matrícula. **Read that document first** — this spec
assumes its findings (URLs, HTML structure, search semantics, encoding
gotchas, measured empty-field rates) rather than restating them.

The single finding that shapes the whole design: **the empty profile is
the common case.** In 3 of the 4 docentes on a real atestado, the entire
`#perfil-docente` block collapses to "Perfil pessoal não cadastrado" —
no bio, no education, no Lattes, no photo. What survives is `#contato`
(filled in 4 of 4) and the courses-taught table. A layout that assumes a
rich profile leaves three quarters of the screen looking broken.

## Scope

**Phase 1 only.** Name→siape resolution with caching, plus the three
profile pages (`portal.jsf`, `disciplinas.jsf`, `producao.jsf`), a list
screen and a detail screen.

**Out of scope, deliberately:** the docente photo. The investigation
settled that it needs a backend proxy with resize and a Railway bucket
(~700 KB PNGs whose `idFoto`+`key` pair only exists inside SIGAA's HTML).
That is phase 2 and gets its own spec. Phase 1 renders initials.

Also out of scope: sweeping all 94 departments to build a complete
docente catalogue, and surfacing docentes from past semesters. The list
shows the current term only.

## Product decisions

These came out of the design conversation and are not implementation
details:

1. **List plus detail route**, not one long expandable screen. Course
   history runs long and would bury the list.
2. **The card carries identity; the detail carries everything else.**
   Card: name, department, the course(s) this docente teaches *you*, and
   a row of badges saying what is inside.
3. **A card with no public profile is disabled** — it does not navigate,
   and it says why ("perfil não disponível no SIGAA"). This is not an
   edge case: 1 of 5 docentes on the real atestado had no public record.
   The badges exist so a tap is never wasted.
4. **The cold load is paid on tab open**, with skeleton cards and an
   explanatory toast. No background warm-up hooked into the schedule
   sync.

## Data model

Two global tables. Unlike `CachedGrade`/`CachedSchedule`, these carry no
`userId`: a public profile is the same for everybody, so the second
student in ENGG54 costs zero SIGAA requests. With the app confined to a
few courses, the docente set saturates quickly and the steady state is
approximately no SIGAA traffic per screen open.

```prisma
// Global — not a per-user cache: the public profile is identical for everyone.
model Docente {
  siape        String  @id
  nome         String
  departamento String?
  unidade      String?

  // portal.jsf #perfil-docente — absent in 3 of 4 in the real sample
  descricaoPessoal String?  @map("descricao_pessoal")
  formacao         String[] @default([])
  areasInteresse   String[] @default([]) @map("areas_interesse")
  lattesUrl        String?  @map("lattes_url")

  // portal.jsf #contato — filled in 4 of 4
  enderecoProfissional String? @map("endereco_profissional")
  sala                 String?
  telefone             String?
  email                String?

  disciplinas    Json @default("[]")
  tccsOrientados Json @default("[]") @map("tccs_orientados")

  orientacoesMestradoAndamento   Int @default(0) @map("orientacoes_mestrado_andamento")
  orientacoesMestradoConcluidas  Int @default(0) @map("orientacoes_mestrado_concluidas")
  orientacoesDoutoradoAndamento  Int @default(0) @map("orientacoes_doutorado_andamento")
  orientacoesDoutoradoConcluidas Int @default(0) @map("orientacoes_doutorado_concluidas")

  fetchedAt  DateTime @default(now()) @map("fetched_at")
  staleAfter DateTime @map("stale_after")

  @@map("docentes")
}

// Normalised name → siape. Stores the MISS (siape null) too, so a docente with
// no public record is not re-searched on every open (see MATA58 in the
// investigation).
model DocenteLookup {
  nomeNormalizado String   @id @map("nome_normalizado")
  nomeOriginal    String   @map("nome_original")
  siape           String?
  resolvedAt      DateTime @default(now()) @map("resolved_at")
  staleAfter      DateTime @map("stale_after")

  @@map("docente_lookup")
}
```

JSON column shapes (not enforced by Prisma, enforced by the repository's
mapping code and its tests):

```ts
disciplinas:    { semestre: string; codigo: string; nome: string;
                  cargaHoraria: number; horario: string }[]
tccsOrientados: { titulo: string; ano: number }[]   // no student name, ever
```

### Three deviations from the investigation's sketch

**`formacao`/`areasInteresse` are `String[]`, not `\n`-joined text.**
The source separates values with `<br />` and the parser produces a list
either way. The schema already uses `String[]` (`Historico.equivalencias`).
Joining only to split again in the client is wasted work.

**`staleAfter` is a stored column, not jitter computed at read time.**
The jitter has to be stable per row: re-rolled on every read, the same row
would flip between fresh and stale. Writing `now + 30d ± 3d` at write time
makes the check a plain `staleAfter < now`, and puts the policy in the
database where it can be inspected. The jitter itself matters because a
term's docentes are all resolved in one burst and would otherwise expire
in one burst.

**No photo columns at all.** The 30-day TTL works in phase 2's favour:
when it lands, rows fill themselves on the next resync. Storing
`fotoId`/`fotoKey` now is storing data nothing reads.

### Invalidation

One rule, identical for hits and misses: a row whose `staleAfter` has
passed is **served anyway** and resynced outside the request. A month-old
profile is not a wrong profile — the page changes about once per term —
and serving stale makes a SIGAA outage invisible to the user. A failed
background resync is simply retried on the next access.

This is separate from the cold-load decision. The skeleton is the price of
a row that *does not exist*; a stale row never makes anyone wait.

The cost of one unified rule is that a miss can lag by up to a month: a
docente registered mid-term appears up to 30 days late. In a ~4.5-month
term that is lateness, not error, and it buys one code path instead of two.

## Backend architecture

### Module layout

New Nest module `backend/src/docentes/`:

- `docentes.module.ts`
- `docentes.controller.ts`
- `docentes.service.ts`
- `docente.repository.ts` — interface + token, Prisma implementation in
  `backend/src/db/prisma-docente.repository.ts`, following the
  `HistoricoRepository` precedent

It imports `SigaaEngineModule` only for the HTTP client. It does **not**
live inside `sigaa-engine/`, because that module is "things that need the
student's credentials" and a docente profile is the opposite: public,
global, user-less.

Parsers stay in `sigaa-engine/parsers/` where the project's parser
convention (cheerio + `__fixtures__/*.html`) already lives:

- `docente-busca.ts` — search results → `{ siape, nome, departamento }[]`
- `docente-portal.ts` — `portal.jsf` → profile + contact
- `docente-disciplinas.ts` — `disciplinas.jsf` → courses taught
- `docente-producao.ts` — `producao.jsf` → supervised TCCs + counts

### `PublicSigaaSession`

New class in `sigaa-engine/public-session.ts`. A cold GET to seed
`JSESSIONID` and `ViewState=j_id1`, then POSTs chaining the ViewState. It
shares `SigaaHttpClient` and the existing `withRetry`/429 handling, and
duplicates roughly fifteen lines of cookie/ViewState capture from
`SigaaSession`.

The duplication is deliberate. `SigaaSession` is built around
login/relogin/credentials and is the most critical path in the backend;
extracting a shared base to serve a consumer that did not exist yesterday
puts the whole app at risk to save fifteen lines. Extract it if a third
consumer appears.

### API

**`POST /docentes/semestre`** — JWT-guarded.

```ts
// request
{ turmas: { codigo: string; nome: string; docente: string }[] }
```

Only turmas that have a docente. The code↔docente pairing is not
decoration: it is the homonym tiebreaker (cross the candidate's
`disciplinas.jsf` against the course code in the current term) and it is
what fills "teaches you MATA65" on the card.

```ts
// response: one item per distinct docente
{
  nomeOriginal: string;                    // as it came off the atestado
  componentes: { codigo: string; nome: string }[];
  perfil: null | {                         // null ⇒ card disabled
    siape: string;
    nome: string;                          // as registered in SIGAA
    departamento: string | null;
    unidade: string | null;
    selos: {
      contato: boolean;
      formacao: boolean;
      areasInteresse: boolean;
      lattes: boolean;
      orientacoes: boolean;
      semestresLecionando: number;
    };
  };
}[]
```

The badges decide whether a card is worth tapping, so they are computed
server-side from what was actually persisted. The client never infers
density from null fields. Precisely:

- `contato` — any of address, sala, telefone, e-mail is non-null
- `formacao` / `areasInteresse` — the array is non-empty
- `lattes` — `lattesUrl` is non-null
- `orientacoes` — any supervised TCC, or any of the four counts is > 0
- `semestresLecionando` — count of distinct `semestre` values in
  `disciplinas`

**`GET /docentes/:siape`** — JWT-guarded. Full profile, straight from the
database, never touching SIGAA on the request path: the list endpoint has
already guaranteed the row exists. A stale row is served and revalidated
in the background. 404 if the siape is unknown.

### Resolution flow

For each docente name in the request:

1. **Normalise** — uppercase, NFD with diacritics stripped, whitespace
   collapsed. This solves two problems at once. The registry is not
   uniform (accented and mixed-case names both occur), and SIGAA reads the
   POST body as ISO-8859-1, so a UTF-8 accent produces a silent 200 with
   no table and no error message. An ASCII-only query makes the
   `URLSearchParams` UTF-8 encoding in `encodeFormBody` irrelevant here.
   Fixing `encodeFormBody` properly remains worth doing, as its own item,
   not as a prerequisite for this one.
2. **Look up** `DocenteLookup` by normalised name. Fresh hit with a siape →
   load `Docente`. Fresh miss (`siape: null`) → return `perfil: null`
   without touching the network.
3. **Resolve what is missing.** One `PublicSigaaSession` per request (one
   cold GET), then **sequential** search POSTs — the ViewState chains, so
   they cannot be parallelised.
4. **Pick the candidate.** Dedupe by `siape` (each docente appears twice,
   once per lotação), filter by exact normalised equality, and fall back to
   the first occurrence only when nothing matches exactly — the search is a
   contiguous-substring match, so a name that is a prefix of another returns
   both (measured: 1 case in 339). More than one exact match with different
   siapes → disambiguate by the course code; if still ambiguous, **do not
   guess**, return `perfil: null`.
5. **Fetch the profile.** The three GETs are stateless, so they run in
   parallel. A ceiling of 4 concurrent profile GETs across the whole
   request keeps traffic modest against endpoints whose rate limit nobody
   has measured. (The search POSTs are unaffected — they are serial by
   necessity.)
6. **Persist** `Docente` and `DocenteLookup`, both with a fresh
   `staleAfter`.

### Failure handling

**A miss is written only when the search answered and found nothing.**
A network error, a 429, or an unexpected 302 returns `perfil: null` for
that docente without touching `DocenteLookup` — otherwise thirty seconds
of SIGAA downtime freezes a "does not exist" for thirty days.

One docente failing does not fail the others: resolution is per-name and
errors are contained to their own item. The endpoint returns 200 with
`perfil: null` for whatever could not be resolved. It returns an error
only when the public session itself cannot be established.

### Parser notes carried over from the investigation

These are the measured behaviours the parsers must encode; the
investigation has the evidence.

- A missing or invalid `siape` yields **302, not 404**. Validate on
  status, not body.
- `producao.jsf`'s `<h2>` counts are **inflated by duplicate rows**. Dedupe
  on `(nível, nome, início)` before counting. The student name is a dedupe
  key in memory only and is never persisted.
- The supervision `situação` field is not reliable on its own (rows exist
  with an end date and "Orientação em Andamento", and "Concluída em " with
  no date). Do not derive state from it alone.
- Parse `producao.jsf` rows **right to left**: a TCC title may contain a
  comma, so the last field is the `MM/AAAA` date, the second-to-last is the
  name, and the remainder is the title.
- `disciplinas.jsf` emits schedule codes in exactly the
  `24T34 (19/08/2026 - 19/12/2026)` form that `schedule-code.ts` already
  parses. Reuse it; write no new schedule parser.

## Mobile

### Where the list of docentes comes from

**Amended 2026-08-19, after roadmap item 2 landed.** This section originally
specified a device-side `turmas-cache.ts` written by the home screen,
because fetching the schedule cost a SIGAA login plus the atestado (~3-5s)
and turmas were not shared state between screens.

That premise is gone. The backend now persists the schedule, and
`getSchedule(accessToken)` is a plain cached read — no credentials, no
SIGAA round trip. The Professores tab calls it directly and derives the
docente names from `turmas`, then posts them to `/docentes/semestre`. No
local cache, no home-screen write.

`getSchedule` returns
`{ sincronizado: false } | { turmas, periodoLetivo, fetchedAt }`, which adds
a fourth screen state to the three below: **never synced** — distinct from
"no turmas", and it points the user at Início.

### Files

| File | Purpose |
|---|---|
| `src/app/(tabs)/professores.tsx` | list screen |
| `src/app/professor/[siape].tsx` | detail route (outside the tabs, like `avatar-picker`) |
| `src/components/DocenteCard.tsx` | card, badges, disabled state |
| `src/lib/api.ts` | `postDocentesSemestre`, `getDocente` |
| `src/lib/types.ts` | `DocenteResumo`, `DocentePerfil` |
| `src/components/AppIcon.tsx` | add `IconChalkboardTeacher` |
| `src/app/(tabs)/_layout.tsx` | tab between Trajetória and Documentos |

### The card

Initials avatar (no photo in phase 1), name, department, chips for the
courses this docente teaches you, and the badge row. Disabled state —
`perfil: null` — renders at reduced opacity with no chevron and the
caption "perfil não disponível no SIGAA", and does not navigate.

### Three distinct empty states

They are not the same thing and must not look the same:

1. **Turma with no docente on the atestado** (MATA59 in the sample) — a
   muted "docente não informado" card. The client renders this itself; the
   name never goes to the backend.
2. **Docente with no public record** — the disabled card above.
3. **No turmas at all** — full-screen empty state, matching the tone of
   the app's other empty screens.

### The detail screen

Ordered by what the investigation measured as most-often-present and
most-wanted: contact (address, sala, ramal, e-mail) first, then courses
taught grouped by term (which also yields "teaches this course for N
terms"), then bio, education and research interests when they exist, then
the Lattes link, then supervision — supervised TCC titles as a map of
what they will supervise, and supervision counts by level and state as a
signal of availability. Sections with no data are omitted, not rendered
empty.

### Cold load

Skeleton cards plus `toast.show` (HeroUI's `useToast`, already the app's
pattern) explaining that profiles are being fetched from SIGAA for the
first time. The toast dismisses itself well before ten seconds are up, so
it is backed by a fixed line above the skeleton — "Buscando perfis no
SIGAA — só na primeira vez". The toast delivers the news; the line
sustains the wait.

## Testing

TDD, in the order the pieces stand up.

**Parsers** — the bulk of the work, and the part that needs real SIGAA
HTML captured once by hand into `parsers/__fixtures__/`:

- `docente-portal` needs **two** fixtures: a rich profile and a
  `<p class="vazio">` one. The empty case is the common case and it is the
  one that breaks layouts.
- `docente-busca` needs three: results with per-lotação duplicates, a
  zero-result response, and the "mínimo 4 caracteres" error.
- `docente-producao` needs the dump with duplicated supervision rows
  (siape 1652496 in the investigation) — the test must prove the dedupe
  corrects the inflated `<h2>` count.
- `docente-disciplinas` reuses `schedule-code.ts` for the schedule field.

**Name normalisation** — pure unit tests: accents, mixed case, doubled
whitespace, and the measured `ALINE SILVA ⊂ ALINE SILVA DE MOURA` case
proving exact-equality filtering picks the right one.

**`PublicSigaaSession`** — fake HTTP client, as `session.spec.ts` does.
Covers the cold POST returning 302 and the `j_id1 → j_id2` chaining.

**`DocentesService`** — fake repository. The cases that matter are the
failure ones: a network error must **not** write a miss; a genuine
zero-result **must**; one docente failing must not sink the others; a
stale row is served and revalidated.

**Controller** — supertest, auth guard included.

**Mobile** — RTL: all three empty states render distinctly, a disabled
card does not navigate, badges reflect the payload, errors offer retry.
Mind the RTL v14 fake-timer trap this codebase has hit before (render
async; advancing timers needs an async `act` and a drain before
`useRealTimers`).

No test hits the real SIGAA. Fixtures are captured once, by hand, and
versioned.

## Open risks

1. **Rate limits on the public endpoints are unmeasured.** On-demand
   resolution with a global cache keeps volume low, and the existing
   `withRetry`/429 handling is the floor, but nobody has tested volume.
2. **Homonyms have not appeared yet** — 339 distinct docentes in the
   "SILVA" sample, no name repeated across siapes. With ~5000 docentes it
   is a matter of time. The course-code tiebreaker is specified above; if
   it still cannot decide, the design refuses to guess.
3. **`encodeFormBody` is UTF-8 only.** Normalisation sidesteps it here,
   but the underlying bug survives and will bite the next feature that
   posts human text to SIGAA.
