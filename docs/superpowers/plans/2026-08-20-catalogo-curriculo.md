# Catálogo de Cursos e Matérias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist, on demand, the SIGAA curriculum catalog — courses, their active curriculum structure, and every component in it (obrigatória/optativa/complementar, workload, pré-requisito/co-requisito/equivalências) — as the data foundation for Trajetória (roadmap item 4), optativa selection (item 5), and semestralization milestones (item 8).

**Architecture:** A new Nest module (`backend/src/curriculo/`) resolves SIGAA's public course catalog through a chain of unauthenticated JSF pages (course directory → curriculum list → curriculum matrix → per-component detail), caching the result in three tables: a bulk-refreshed `Curso` directory, and per-course, on-demand `EstruturaCurricular`/`ComponenteCurricular` rows. It reuses the `SigaaHttpClient`/`withRetry` plumbing already in `sigaa-engine/`, and follows the `PublicSigaaSession` shape from the (in-progress, not yet merged) professores feature for the stateful ViewState-chained POSTs — as its own small class, not a shared base, matching that feature's own "extract only on a third consumer" call.

**Tech Stack:** NestJS, Prisma/PostgreSQL, cheerio, Jest.

**Spec:** [`docs/superpowers/specs/2026-08-20-catalogo-curriculo-design.md`](../specs/2026-08-20-catalogo-curriculo-design.md) — read it first.

**Branch dependency:** This plan builds **on top of `worktree-professores`** (branch `worktree-professores`), not `master`. That branch already has `SigaaHttpClient`, `withRetry`, `createSigaaHttpClient`, the `Docente`/`DocenteLookup` schema, and the `PublicSigaaSession` pattern this plan's session class mirrors. Start every task from that branch; do not attempt to cherry-pick just the pieces this plan needs onto `master`.

## Global Constraints

- **On demand, not eager.** No cron, no background sweep of the 284 courses. A course's curriculum is fetched only when `CurriculoService` is asked for it and its cache is missing or stale.
- **Only the "Ativa" curriculum structure is resolved**, never the student's exact historical one. `Historico.curriculo` (e.g. `"G20251 - 2025.2"`) is not consulted by this plan — reconciling students on an older, now-"Inativa" structure is explicitly deferred (see spec's Scope section).
- **Pré-requisito/co-requisito/equivalências are stored as raw text**, exactly as SIGAA renders them (e.g. `"(FISD36 E FISD42) OU (ENGJ18)"`). No boolean-expression parser, no vigência/history tables. SIGAA prints `"-"` for an empty field — that must become `null`, never the literal string `"-"`.
- **Per-component detail requests run in parallel**, capped at 4 concurrent per curriculum resolved (matches the professores feature's ceiling on its own parallel profile GETs). This is safe because it was measured directly: reusing the same `ViewState` for two different component ids both succeeded (see spec's Motivation section).
- **Directory (`Curso`) and per-course data (`EstruturaCurricular`/`ComponenteCurricular`) are replaced wholesale on refresh**, never upserted row-by-row — same rationale as `CachedSchedule`/`Historico`: the fetch is the complete state, so a stale row left behind by a partial upsert would be silently wrong.
- **`staleAfter` is computed at write time with jitter**, not at read time — identical rationale to the `Docente`/`DocenteLookup` TTL: a jitter re-rolled on every read would flip the same row between fresh and stale, and un-jittered TTLs synchronize expiry into a single burst.
- **A curriculum resolution that finds no "Ativa" structure writes nothing** — no partial/incorrect catalog is ever persisted for that course.
- **A single component's detail-fetch failure does not fail the others** — that component is persisted with null pré-requisito/co-requisito/equivalências, and a future re-resolution (once the whole structure goes stale) retries it.
- All endpoints are JWT-guarded, same convention as the rest of the backend, even though the underlying SIGAA data needs no login.
- Backend tests: `npm test -- <path>` from `backend/`. Backend code and comments in English, matching the existing codebase.

---

### Task 1: Capture the SIGAA fixtures

No parser can be written test-first without real HTML. This task produces five fixture files and nothing else. The capture script is **throwaway** — deleted in the final step, not committed. All requests are unauthenticated, against the same public pages any browser reaches without logging in.

Every path/id below was verified live during this feature's spike — they are not guesses.

**Files:**
- Create (temporary, deleted in step 7): `backend/scripts/capture-curriculo-fixtures.ts`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/curso-lista.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/curso-estruturas.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/estrutura-resumo.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/componente-resumo-com-prerequisito.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/componente-resumo-sem-prerequisito.html`

**Interfaces:**
- Consumes: `createSigaaHttpClient` from `src/sigaa-engine/http-client.ts` (already exists on `worktree-professores`).
- Produces: the five fixture files above. Every later parser task reads them.

- [ ] **Step 1: Write the capture script**

Create `backend/scripts/capture-curriculo-fixtures.ts`:

```ts
/**
 * THROWAWAY. Captures the public curriculum pages once so the parsers can be
 * written test-first. Deleted at the end of Task 1 — CurriculoPublicSession
 * (Task 8) is the real, tested implementation of the same handshake.
 *
 * Run: npx ts-node scripts/capture-curriculo-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSigaaHttpClient } from '../src/sigaa-engine/http-client';

const OUT = join(
  __dirname,
  '..',
  'src',
  'sigaa-engine',
  'parsers',
  '__fixtures__',
);
const VIEW_STATE = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID = /JSESSIONID=[^;]+/;

const http = createSigaaHttpClient();

function save(name: string, html: string): void {
  writeFileSync(join(OUT, name), html, 'utf-8');
  console.log(`${name}: ${html.length} chars`);
}

async function main(): Promise<void> {
  // --- course directory (static, no session needed) --------------------
  const lista = await http.request({
    method: 'GET',
    path: '/sigaa/public/curso/lista.jsf',
  });
  if (lista.status !== 200) throw new Error(`lista.jsf → ${lista.status}`);
  save('curso-lista.html', lista.body);

  // --- curriculum structures for ENGENHARIA DA COMPUTAÇÃO (id=1876880) -
  const estruturas = await http.request({
    method: 'GET',
    path: '/sigaa/public/curso/curriculo.jsf?lc=pt_BR&id=1876880',
  });
  if (estruturas.status !== 200)
    throw new Error(`curriculo.jsf → ${estruturas.status}`);
  save('curso-estruturas.html', estruturas.body);

  const cookie = (estruturas.headers['set-cookie'] ?? '').match(JSESSIONID);
  const viewState = estruturas.body.match(VIEW_STATE);
  if (!cookie || !viewState) {
    throw new Error('curriculo.jsf carried no JSESSIONID/ViewState');
  }

  // --- click through to the ACTIVE structure's matrix (estrutura G20251,
  // SIGAA id 2413433) -----------------------------------------------------
  const matriz = await http.request({
    method: 'POST',
    path: '/sigaa/public/curso/curriculo.jsf',
    cookie: cookie[0],
    body: {
      formCurriculosCurso: 'formCurriculosCurso',
      nivel: 'G',
      'javax.faces.ViewState': viewState[1],
      'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1':
        'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1',
      id: '2413433',
    },
  });
  if (matriz.status !== 200) throw new Error(`matriz → ${matriz.status}`);
  save('estrutura-resumo.html', matriz.body);

  const matrizViewState = matriz.body.match(VIEW_STATE);
  const conversationViewState = matrizViewState
    ? matrizViewState[1]
    : viewState[1];

  // --- two component details: one with pré-requisito/equivalências (ENG295,
  // id 30548), one whose pré-requisito is empty (FISD36, id 34997) --------
  const comRequisito = await http.request({
    method: 'POST',
    path: '/sigaa/public/curso/resumo_curriculo.jsf',
    cookie: cookie[0],
    body: {
      formulario: 'formulario',
      'javax.faces.ViewState': conversationViewState,
      'formulario:j_id_jsp_337523315_46':
        'formulario:j_id_jsp_337523315_46',
      id: '30548',
      publico: 'public',
    },
  });
  if (comRequisito.status !== 200)
    throw new Error(`componente 30548 → ${comRequisito.status}`);
  save('componente-resumo-com-prerequisito.html', comRequisito.body);

  const semRequisito = await http.request({
    method: 'POST',
    path: '/sigaa/public/curso/resumo_curriculo.jsf',
    cookie: cookie[0],
    body: {
      formulario: 'formulario',
      'javax.faces.ViewState': conversationViewState,
      'formulario:j_id_jsp_337523315_66':
        'formulario:j_id_jsp_337523315_66',
      id: '34997',
      publico: 'public',
    },
  });
  if (semRequisito.status !== 200)
    throw new Error(`componente 34997 → ${semRequisito.status}`);
  save('componente-resumo-sem-prerequisito.html', semRequisito.body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the capture script**

Run: `cd backend && npx ts-node scripts/capture-curriculo-fixtures.ts`
Expected: five `console.log` lines, one per saved file, each reporting a non-zero char count. If any step throws (SIGAA's onclick param names or ids have since changed), re-derive the failing request's parameters by re-fetching the previous step's HTML and re-reading its `onclick` attributes — the párameter names are stable JSF-generated ids but not guaranteed forever.

- [ ] **Step 3: Verify each fixture's shape by eye**

Run: `grep -c "linhaPar\|linhaImpar" backend/src/sigaa-engine/parsers/__fixtures__/curso-lista.html` — expect a large count (hundreds of course rows).
Run: `grep -o "G20251\|T20252\|186140" backend/src/sigaa-engine/parsers/__fixtures__/curso-estruturas.html` — expect all three codes present.
Run: `grep -o "Ativa" backend/src/sigaa-engine/parsers/__fixtures__/curso-estruturas.html` — expect exactly one match (the G20251 row).
Run: `grep -o "ENG295\|FISD36" backend/src/sigaa-engine/parsers/__fixtures__/estrutura-resumo.html | sort -u` — expect both codes present.
Run: `grep -c "Pr&#233;-Requisitos" backend/src/sigaa-engine/parsers/__fixtures__/componente-resumo-com-prerequisito.html backend/src/sigaa-engine/parsers/__fixtures__/componente-resumo-sem-prerequisito.html` — expect 1 for each file.

- [ ] **Step 4: Delete the capture script**

```bash
rm backend/scripts/capture-curriculo-fixtures.ts
```

- [ ] **Step 5: Commit the fixtures**

```bash
cd backend
git add src/sigaa-engine/parsers/__fixtures__/curso-lista.html \
  src/sigaa-engine/parsers/__fixtures__/curso-estruturas.html \
  src/sigaa-engine/parsers/__fixtures__/estrutura-resumo.html \
  src/sigaa-engine/parsers/__fixtures__/componente-resumo-com-prerequisito.html \
  src/sigaa-engine/parsers/__fixtures__/componente-resumo-sem-prerequisito.html
git commit -m "test(backend): capture SIGAA curriculum catalog fixtures"
```

---

### Task 2: Prisma schema — `Curso`, `EstruturaCurricular`, `ComponenteCurricular`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create (via `prisma migrate dev`): `backend/prisma/migrations/<timestamp>_add_curriculo/`

**Interfaces:**
- Produces: the three Prisma models and their generated client types (`Curso`, `EstruturaCurricular`, `ComponenteCurricular` from `@prisma/client`), consumed by Task 9's repository.

- [ ] **Step 1: Add the models to `schema.prisma`**

Append to `backend/prisma/schema.prisma`:

```prisma
// Global directory of UFBA courses (all níveis — graduação, especialização,
// mestrado, doutorado — nivel comes straight off each row's own link).
// Replaced by completo on refresh, same rationale as CachedSchedule: it is
// the whole lista.jsf, ~284 rows, so there is no reason to upsert row by row.
model Curso {
  idSigaa      String   @id @map("id_sigaa")
  nome         String
  sede         String
  nivel        String
  atualizadoEm DateTime @default(now()) @map("atualizado_em")

  estruturas EstruturaCurricular[]

  @@map("cursos")
}

// A specific curriculum structure (G20251, T20252, 186140...) of a curso.
// Resolved on demand, per course, and always the structure SIGAA marks
// "Ativa" — see the design spec's Scope section for why an older structure a
// student is actually on is not resolved here.
model EstruturaCurricular {
  idSigaa                        String   @id @map("id_sigaa")
  cursoId                        String   @map("curso_id")
  codigo                         String // "G20251" — matches Historico.curriculo's prefix
  anoPeriodoImplementacao        String   @map("ano_periodo_implementacao")
  cargaHorariaTotal              Int      @map("carga_horaria_total")
  cargaHorariaObrigatoria        Int      @map("carga_horaria_obrigatoria")
  cargaHorariaOptativaMinima     Int      @map("carga_horaria_optativa_minima")
  cargaHorariaComplementarMinima Int      @map("carga_horaria_complementar_minima")
  prazoMinimoSemestres           Int      @map("prazo_minimo_semestres")
  prazoMedioSemestres            Int      @map("prazo_medio_semestres")
  prazoMaximoSemestres           Int      @map("prazo_maximo_semestres")

  fetchedAt  DateTime @default(now()) @map("fetched_at")
  staleAfter DateTime @map("stale_after")

  curso       Curso                  @relation(fields: [cursoId], references: [idSigaa])
  componentes ComponenteCurricular[]

  @@unique([cursoId, codigo])
  @@map("estruturas_curriculares")
}

model ComponenteCurricular {
  id                    String  @id @default(uuid())
  estruturaCurricularId String  @map("estrutura_curricular_id")
  // The component's own SIGAA id (e.g. "30548") — used to fetch its detail page.
  idSigaa               String  @map("id_sigaa")
  codigo                String
  nome                  String
  cargaHoraria          Int     @map("carga_horaria")
  natureza              String // OBRIGATORIA | OPTATIVA | COMPLEMENTAR
  periodo               Int? // null for optativas/complementares

  // Free on the same detail-page fetch as pré-requisito/equivalências — no
  // extra request.
  unidadeResponsavel String? @map("unidade_responsavel")
  preRequisito       String? @map("pre_requisito") // raw text: "(FISD36 E FISD42) OU (ENGJ18)"
  coRequisito        String? @map("co_requisito")
  equivalencias      String? @map("equivalencias") // raw text: "(ENG295A) OU (ENG295B)"

  estruturaCurricular EstruturaCurricular @relation(fields: [estruturaCurricularId], references: [idSigaa], onDelete: Cascade)

  @@unique([estruturaCurricularId, codigo])
  @@map("componentes_curriculares")
}
```

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npx prisma migrate dev --name add_curriculo`
Expected: a new folder under `backend/prisma/migrations/` and `Prisma Client generated successfully`.

- [ ] **Step 3: Verify the client types exist**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i curriculo || echo "no curriculo-related type errors"`
Expected: `no curriculo-related type errors` (the models aren't referenced by any code yet, so there is nothing to type-check against them — this just confirms the generate step didn't break the build).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(backend): add Curso/EstruturaCurricular/ComponenteCurricular schema"
```

---

### Task 3: Parser — `curso-lista.ts`

**Files:**
- Create: `backend/src/sigaa-engine/parsers/curso-lista.ts`
- Test: `backend/src/sigaa-engine/parsers/curso-lista.spec.ts`

**Interfaces:**
- Consumes: `backend/src/sigaa-engine/parsers/__fixtures__/curso-lista.html` (Task 1).
- Produces: `parseCursoLista(html: string): CursoListaItem[]`, `interface CursoListaItem { idSigaa: string; nome: string; sede: string; nivel: string }` — consumed by Task 9's repository and Task 10's service.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursoLista } from './curso-lista';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseCursoLista', () => {
  const cursos = parseCursoLista(fixture('curso-lista.html'));

  it('extracts idSigaa, nome, sede and nivel from each course row', () => {
    const engComp = cursos.find(
      (c) => c.nome === 'ENGENHARIA DA COMPUTAÇÃO' && c.nivel === 'G',
    );
    expect(engComp).toEqual({
      idSigaa: '1876880',
      nome: 'ENGENHARIA DA COMPUTAÇÃO',
      sede: 'SALVADOR',
      nivel: 'G',
    });
  });

  it('skips the unidade header rows, which have no course link of their own', () => {
    expect(cursos.some((c) => c.nome.includes('ESCOLA POLITÉCNICA'))).toBe(
      false,
    );
  });

  it('parses more than one course', () => {
    expect(cursos.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curso-lista.spec.ts`
Expected: FAIL — `Cannot find module './curso-lista'`.

- [ ] **Step 3: Write the parser**

```ts
import * as cheerio from 'cheerio';

export interface CursoListaItem {
  idSigaa: string;
  nome: string;
  sede: string;
  nivel: string;
}

// portal.jsf?id=1876880&lc=pt_BR&nivel=G
const HREF_PATTERN = /[?&]id=(\d+)&lc=[^&]*&nivel=(\w+)/;

/**
 * lista.jsf mixes two row shapes in the same `table.listagem`: a
 * `colspan`-wide header row naming the unidade (e.g. "EPOLI - ESCOLA
 * POLITÉCNICA") and, below it, one two-cell data row per course the unidade
 * offers. Only the second shape carries a course.
 */
export function parseCursoLista(html: string): CursoListaItem[] {
  const $ = cheerio.load(html);
  const cursos: CursoListaItem[] = [];

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length < 2) {
      return;
    }

    const nome = $(cells[0]).text().trim();
    const sede = $(cells[1]).text().trim();
    const href =
      $row.find('a[title="Visualizar Página do Curso"]').attr('href') ?? '';
    const match = href.match(HREF_PATTERN);

    if (!nome || !sede || !match) {
      return;
    }

    cursos.push({ idSigaa: match[1], nome, sede, nivel: match[2] });
  });

  return cursos;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curso-lista.spec.ts`
Expected: PASS (3 tests). If the `nome`/`sede` assertion fails, open the fixture and confirm `ENGENHARIA DA COMPUTAÇÃO`/`SALVADOR` still appear under `EPOLI` with `nivel=G` — SIGAA's own catalog can change between the spike and implementation.

- [ ] **Step 5: Commit**

```bash
git add src/sigaa-engine/parsers/curso-lista.ts src/sigaa-engine/parsers/curso-lista.spec.ts
git commit -m "feat(backend): parse the public curso directory"
```

---

### Task 4: Parser — `curso-estruturas.ts`

**Files:**
- Create: `backend/src/sigaa-engine/parsers/curso-estruturas.ts`
- Test: `backend/src/sigaa-engine/parsers/curso-estruturas.spec.ts`

**Interfaces:**
- Consumes: `backend/src/sigaa-engine/parsers/__fixtures__/curso-estruturas.html` (Task 1).
- Produces: `parseCursoEstruturas(html: string): CursoEstrutura[]`, `interface CursoEstrutura { codigo: string; ativa: boolean; jsfParams: Record<string, string> }` — `jsfParams` is consumed by Task 8's `CurriculoPublicSession.postar` to click through to the matrix.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursoEstruturas } from './curso-estruturas';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseCursoEstruturas', () => {
  const estruturas = parseCursoEstruturas(fixture('curso-estruturas.html'));

  it('lists every curriculum structure with its código and status', () => {
    const codigos = estruturas.map((e) => e.codigo);
    expect(codigos).toEqual(
      expect.arrayContaining(['G20251', 'T20252', '186140']),
    );
  });

  it('identifies exactly one structure as ativa', () => {
    expect(estruturas.filter((e) => e.ativa)).toHaveLength(1);
    expect(estruturas.find((e) => e.ativa)?.codigo).toBe('G20251');
  });

  it("captures the jsfcljs params needed to click through to that structure's matrix", () => {
    const ativa = estruturas.find((e) => e.ativa);
    expect(ativa?.jsfParams.id).toMatch(/^\d+$/);
    expect(Object.keys(ativa!.jsfParams).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curso-estruturas.spec.ts`
Expected: FAIL — `Cannot find module './curso-estruturas'`.

- [ ] **Step 3: Write the parser**

```ts
import * as cheerio from 'cheerio';

export interface CursoEstrutura {
  codigo: string;
  ativa: boolean;
  jsfParams: Record<string, string>;
}

// "Detalhes da Estrutura Curricular G20251, Criado em  2025"
const CODIGO_PATTERN = /Estrutura Curricular\s+(\S+),/;
// Every key:value pair inside the onclick's jsfcljs({...}) object literal —
// this deliberately does not hardcode the JSF-generated field name, since
// only the shape (two string keys, one of which is "id") is guaranteed.
const JSF_PARAM_PATTERN = /'([^']+)':'([^']+)'/g;

/**
 * curriculo.jsf lists every curriculum structure of a course — active and
 * retired — as rows in `table#table_lt`. The "Visualizar Estrutura
 * Curricular" link is a JSF ajax postback (jsfcljs), not a plain href: its
 * onclick attribute carries the exact form fields curso-estruturas' caller
 * must POST back to reach the matrix (see estrutura-resumo.ts).
 */
export function parseCursoEstruturas(html: string): CursoEstrutura[] {
  const $ = cheerio.load(html);
  const estruturas: CursoEstrutura[] = [];

  $('table#table_lt tr.linha_par, table#table_lt tr.linha_impar').each(
    (_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 3) {
        return;
      }

      const codigoMatch = $(cells[0]).text().match(CODIGO_PATTERN);
      if (!codigoMatch) {
        return;
      }
      const codigo = codigoMatch[1];
      const status = $(cells[1]).text().trim();

      const onclick =
        $(cells[2])
          .find('a[title="Visualizar Estrutura Curricular"]')
          .attr('onclick') ?? '';
      const jsfParams: Record<string, string> = {};
      for (const match of onclick.matchAll(JSF_PARAM_PATTERN)) {
        jsfParams[match[1]] = match[2];
      }
      if (Object.keys(jsfParams).length === 0) {
        return;
      }

      estruturas.push({ codigo, ativa: status === 'Ativa', jsfParams });
    },
  );

  return estruturas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curso-estruturas.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sigaa-engine/parsers/curso-estruturas.ts src/sigaa-engine/parsers/curso-estruturas.spec.ts
git commit -m "feat(backend): parse a course's curriculum structures"
```

---

### Task 5: Parser — `estrutura-resumo.ts`

**Files:**
- Create: `backend/src/sigaa-engine/parsers/estrutura-resumo.ts`
- Test: `backend/src/sigaa-engine/parsers/estrutura-resumo.spec.ts`

**Interfaces:**
- Consumes: `backend/src/sigaa-engine/parsers/__fixtures__/estrutura-resumo.html` (Task 1).
- Produces: `parseEstruturaResumo(html: string): EstruturaResumo`, with:
  ```ts
  export interface ComponenteResumoMatriz {
    idSigaa: string;
    codigo: string;
    nome: string;
    cargaHoraria: number;
    natureza: 'OBRIGATORIA' | 'OPTATIVA' | 'COMPLEMENTAR';
    periodo: number | null;
  }

  export interface EstruturaResumo {
    anoPeriodoImplementacao: string;
    cargaHorariaTotal: number;
    cargaHorariaObrigatoria: number;
    cargaHorariaOptativaMinima: number;
    cargaHorariaComplementarMinima: number;
    prazoMinimoSemestres: number;
    prazoMedioSemestres: number;
    prazoMaximoSemestres: number;
    componentes: ComponenteResumoMatriz[];
  }
  ```
  Consumed by Task 9's repository (persists `EstruturaCurricular` + `ComponenteCurricular`) and Task 10's service (drives the parallel component-detail fetch).

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEstruturaResumo } from './estrutura-resumo';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseEstruturaResumo', () => {
  const resumo = parseEstruturaResumo(fixture('estrutura-resumo.html'));

  it('extracts the ano/período de vigência and the workload totals', () => {
    expect(resumo.anoPeriodoImplementacao).toBe('2025.2');
    expect(resumo.cargaHorariaTotal).toBe(3610);
    expect(resumo.cargaHorariaObrigatoria).toBe(3150);
    expect(resumo.cargaHorariaOptativaMinima).toBe(360);
    expect(resumo.cargaHorariaComplementarMinima).toBe(100);
  });

  it('extracts the prazo de conclusão in semesters', () => {
    expect(resumo.prazoMinimoSemestres).toBe(12);
    expect(resumo.prazoMedioSemestres).toBe(12);
    expect(resumo.prazoMaximoSemestres).toBe(18);
  });

  it('parses an obrigatória component with its período and SIGAA id', () => {
    const fisd36 = resumo.componentes.find((c) => c.codigo === 'FISD36');
    expect(fisd36).toEqual({
      idSigaa: '34997',
      codigo: 'FISD36',
      nome: 'FÍSICA GERAL TEÓRICA I',
      cargaHoraria: 60,
      natureza: 'OBRIGATORIA',
      periodo: 1,
    });
  });

  it('parses an optativa component with a null período', () => {
    const eng295 = resumo.componentes.find((c) => c.codigo === 'ENG295');
    expect(eng295).toEqual({
      idSigaa: '30548',
      codigo: 'ENG295',
      nome: 'HIGIENE E SEGURANÇA NO TRABALHO',
      cargaHoraria: 60,
      natureza: 'OPTATIVA',
      periodo: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- estrutura-resumo.spec.ts`
Expected: FAIL — `Cannot find module './estrutura-resumo'`.

- [ ] **Step 3: Write the parser**

```ts
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export interface ComponenteResumoMatriz {
  idSigaa: string;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  natureza: 'OBRIGATORIA' | 'OPTATIVA' | 'COMPLEMENTAR';
  periodo: number | null;
}

export interface EstruturaResumo {
  anoPeriodoImplementacao: string;
  cargaHorariaTotal: number;
  cargaHorariaObrigatoria: number;
  cargaHorariaOptativaMinima: number;
  cargaHorariaComplementarMinima: number;
  prazoMinimoSemestres: number;
  prazoMedioSemestres: number;
  prazoMaximoSemestres: number;
  componentes: ComponenteResumoMatriz[];
}

// "ENG295 - HIGIENE E SEGURANÇA NO TRABALHO - 60h"
const COMPONENTE_ROW_PATTERN = /^(\S+)\s*-\s*(.+?)\s*-\s*(\d+)h$/;
const ID_PARAM_PATTERN = /'id':'(\d+)'/;
const HORAS_PATTERN = /(\d+)h/;

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

function horasDe(texto: string): number {
  const match = texto.match(HORAS_PATTERN);
  if (!match) {
    throw new Error(`No "Nh" workload found in "${texto}"`);
  }
  return Number(match[1]);
}

/**
 * table.formulario carries the structure's own label/value stats (código,
 * matriz, prazos, cargas horárias) as plain th/td rows — same shape
 * discente-perfil.ts already relies on elsewhere in this codebase.
 */
function parseResumoStats(
  $: CheerioAPI,
): Omit<EstruturaResumo, 'componentes'> {
  const stats: Record<string, string> = {};
  $('table.formulario tr').each((_, row) => {
    const $row = $(row);
    const th = $row.find('th').first();
    const td = $row.find('td').first();
    if (!th.length || !td.length) {
      return;
    }
    const label = normalizeLabel(th.text());
    if (label && !(label in stats)) {
      stats[label] = td.text().trim();
    }
  });

  const prazoRow = $('table.formulario tr')
    .filter((_, row) =>
      normalizeLabel($(row).find('th').first().text()).startsWith(
        'prazo para conclusao',
      ),
    )
    .first();
  const prazos = prazoRow.find('td table td');

  return {
    anoPeriodoImplementacao: stats['periodo letivo de entrada em vigor'],
    cargaHorariaTotal: horasDe(stats['total minima']),
    cargaHorariaObrigatoria: horasDe(stats['total']),
    cargaHorariaOptativaMinima: horasDe(stats['carga horaria optativa minima']),
    cargaHorariaComplementarMinima: horasDe(
      stats['carga horaria complementar minima'],
    ),
    prazoMinimoSemestres: Number($(prazos[0]).text().trim()),
    prazoMedioSemestres: Number($(prazos[1]).text().trim()),
    prazoMaximoSemestres: Number($(prazos[2]).text().trim()),
  };
}

/**
 * The components live in `table.subFormulario` blocks: one per período
 * (`<div id="semestreN">`, caption "Nº Nível") plus one each for optativas and
 * complementares. Every row packs código/nome/carga horária into a single
 * cell ("CODIGO - NOME - NNNh") and carries the component's own SIGAA id in
 * the "Visualizar Detalhes do Componente" link's onclick.
 */
function parseComponentes($: CheerioAPI): ComponenteResumoMatriz[] {
  const componentes: ComponenteResumoMatriz[] = [];

  $('table.subFormulario').each((_, table) => {
    const $table = $(table);
    const caption = $table.find('caption').first().text().trim();
    const periodoMatch = $table
      .closest('div[id^="semestre"]')
      .attr('id')
      ?.match(/semestre(\d+)/);
    const periodo = periodoMatch ? Number(periodoMatch[1]) : null;

    $table.find('tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 2) {
        return;
      }

      const rowMatch = $(cells[0]).text().trim().match(COMPONENTE_ROW_PATTERN);
      if (!rowMatch) {
        return;
      }
      const naturezaTexto = normalizeLabel($(cells[1]).text());
      const natureza: ComponenteResumoMatriz['natureza'] = naturezaTexto.startsWith(
        'obrigat',
      )
        ? 'OBRIGATORIA'
        : naturezaTexto.startsWith('optat')
          ? 'OPTATIVA'
          : 'COMPLEMENTAR';

      const onclick =
        $row
          .find('a[title="Visualizar Detalhes do Componente"]')
          .attr('onclick') ?? '';
      const idMatch = onclick.match(ID_PARAM_PATTERN);
      if (!idMatch) {
        return;
      }

      componentes.push({
        idSigaa: idMatch[1],
        codigo: rowMatch[1],
        nome: rowMatch[2],
        cargaHoraria: Number(rowMatch[3]),
        natureza,
        periodo,
      });
    });

    // caption is read only for readability while debugging a parser
    // failure — the natureza/periodo distinction above does not depend on it.
    void caption;
  });

  return componentes;
}

export function parseEstruturaResumo(html: string): EstruturaResumo {
  const $ = cheerio.load(html);
  return {
    ...parseResumoStats($),
    componentes: parseComponentes($),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- estrutura-resumo.spec.ts`
Expected: PASS (4 tests). If `cargaHorariaObrigatoria` picks up the wrong number, check whether `stats['total']` collided with another row labeled exactly "Total:" elsewhere on the page — the fixture as captured had only one such row, but confirm against the actual saved file.

- [ ] **Step 5: Commit**

```bash
git add src/sigaa-engine/parsers/estrutura-resumo.ts src/sigaa-engine/parsers/estrutura-resumo.spec.ts
git commit -m "feat(backend): parse a curriculum structure's full matrix"
```

---

### Task 6: Parser — `componente-resumo.ts`

**Files:**
- Create: `backend/src/sigaa-engine/parsers/componente-resumo.ts`
- Test: `backend/src/sigaa-engine/parsers/componente-resumo.spec.ts`

**Interfaces:**
- Consumes: `backend/src/sigaa-engine/parsers/__fixtures__/componente-resumo-com-prerequisito.html`, `.../componente-resumo-sem-prerequisito.html` (Task 1).
- Produces: `parseComponenteResumo(html: string): ComponenteResumoDetalhe`, with:
  ```ts
  export interface ComponenteResumoDetalhe {
    unidadeResponsavel: string | null;
    preRequisito: string | null;
    coRequisito: string | null;
    equivalencias: string | null;
  }
  ```
  Consumed by Task 9's repository (fills the same-named columns on `ComponenteCurricular`) and Task 10's service (the parallel per-component fetch).

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponenteResumo } from './componente-resumo';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseComponenteResumo', () => {
  it('extracts unidade, pré-requisito, co-requisito and equivalências as raw text', () => {
    const detalhe = parseComponenteResumo(
      fixture('componente-resumo-com-prerequisito.html'),
    );
    expect(detalhe.unidadeResponsavel).toBe(
      'DEPARTAMENTO DE ENGENHARIA AMBIENTAL/POLI - SALVADOR - 12.01.23.05',
    );
    expect(detalhe.preRequisito).toBe(
      '( FISD36 E FISD42 E QUI037 ) OU ( ENGJ18 ) OU ( FISD34 E ( QUIA27 OU ( FISD41 E QUI029 ) ) )',
    );
    expect(detalhe.coRequisito).toBeNull();
    expect(detalhe.equivalencias).toBe(
      '( ENG295A ) OU ( ENG295B ) OU ( ENG295C )',
    );
  });

  it('reads SIGAA\'s "-" placeholder as null, not the literal string', () => {
    const detalhe = parseComponenteResumo(
      fixture('componente-resumo-sem-prerequisito.html'),
    );
    expect(detalhe.preRequisito).toBeNull();
    expect(detalhe.coRequisito).toBeNull();
    // FISD36, being foundational, has no pré-requisito but DOES have a
    // recorded equivalência — the two fields are independent, and this
    // fixture is exactly the case that proves it.
    expect(detalhe.equivalencias).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- componente-resumo.spec.ts`
Expected: FAIL — `Cannot find module './componente-resumo'`.

- [ ] **Step 3: Write the parser**

```ts
import * as cheerio from 'cheerio';

export interface ComponenteResumoDetalhe {
  unidadeResponsavel: string | null;
  preRequisito: string | null;
  coRequisito: string | null;
  equivalencias: string | null;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

/**
 * SIGAA prints "-" for an empty pré-requisito/co-requisito/equivalências —
 * that must not be persisted as the literal string.
 */
function valorOuNulo(texto: string): string | null {
  // Collapse the whitespace/newlines the ACRONYM-wrapped codes are laid out
  // with into single spaces, since the expression's own parentheses and
  // spacing (not the source markup's indentation) are what a reader needs.
  const normalizado = texto.replace(/\s+/g, ' ').trim();
  return normalizado === '' || normalizado === '-' ? null : normalizado;
}

/**
 * table.visualizacao carries the same label/value th/td shape as
 * estrutura-resumo's table.formulario. Pré-requisito/equivalências wrap each
 * referenced código in an <ACRONYM> tag, but .text() already flattens that —
 * no special-casing needed beyond the "-" → null rule.
 */
export function parseComponenteResumo(html: string): ComponenteResumoDetalhe {
  const $ = cheerio.load(html);
  const detalhe: ComponenteResumoDetalhe = {
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };

  $('table.visualizacao tr').each((_, row) => {
    const $row = $(row);
    const th = $row.find('th').first();
    const td = $row.find('td').first();
    if (!th.length || !td.length) {
      return;
    }
    const label = normalizeLabel(th.text());
    const valor = valorOuNulo(td.text());

    if (label === 'unidade responsavel') {
      detalhe.unidadeResponsavel = valor;
    } else if (label === 'pre-requisitos') {
      detalhe.preRequisito = valor;
    } else if (label === 'co-requisitos') {
      detalhe.coRequisito = valor;
    } else if (label === 'equivalencias') {
      detalhe.equivalencias = valor;
    }
  });

  return detalhe;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- componente-resumo.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sigaa-engine/parsers/componente-resumo.ts src/sigaa-engine/parsers/componente-resumo.spec.ts
git commit -m "feat(backend): parse a component's pré-requisito/co-requisito/equivalências"
```

---

### Task 7: `curriculo/stale.ts` — TTL with jitter

**Files:**
- Create: `backend/src/curriculo/stale.ts`
- Test: `backend/src/curriculo/stale.spec.ts`

**Interfaces:**
- Produces: `calcularStaleAfter(agora: Date): Date` — consumed by Task 9's repository when writing `Curso`/`EstruturaCurricular`.

This intentionally duplicates `backend/src/docentes/stale.ts` (same 30-day-±3 TTL-with-jitter shape) rather than importing it — same reasoning the professores design already applied to `PublicSigaaSession`: a few duplicated lines are cheaper than a shared dependency between two otherwise-unrelated modules, and either can diverge later without risk to the other.

- [ ] **Step 1: Write the failing test**

```ts
import { calcularStaleAfter } from './stale';

describe('calcularStaleAfter', () => {
  it('lands roughly 30 days out, within the ±3 day jitter window', () => {
    const agora = new Date('2026-01-01T00:00:00Z');
    const staleAfter = calcularStaleAfter(agora);
    const diffDias =
      (staleAfter.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDias).toBeGreaterThanOrEqual(27);
    expect(diffDias).toBeLessThanOrEqual(33);
  });

  it('varies between calls, so a whole batch does not expire at once', () => {
    const agora = new Date('2026-01-01T00:00:00Z');
    const valores = new Set(
      Array.from({ length: 20 }, () => calcularStaleAfter(agora).getTime()),
    );
    expect(valores.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curriculo/stale.spec.ts`
Expected: FAIL — `Cannot find module './stale'`.

- [ ] **Step 3: Write the implementation**

```ts
const DIA_MS = 24 * 60 * 60 * 1000;
const TTL_DIAS = 30;
const JITTER_DIAS = 3;

/**
 * When a freshly written Curso/EstruturaCurricular row should next be
 * resynced. Computed at write time, not read time, so the jitter doesn't
 * flip the same row between fresh and stale on every read — see
 * docentes/stale.ts for the identical rationale (this module doesn't import
 * it: two small, independently-evolvable copies over one shared dependency
 * between otherwise-unrelated features).
 */
export function calcularStaleAfter(agora: Date): Date {
  const jitter = (Math.random() * 2 - 1) * JITTER_DIAS * DIA_MS;
  return new Date(agora.getTime() + TTL_DIAS * DIA_MS + jitter);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curriculo/stale.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/curriculo/stale.ts src/curriculo/stale.spec.ts
git commit -m "feat(backend): add TTL-with-jitter for the curriculum cache"
```

---

### Task 8: `CurriculoPublicSession`

**Files:**
- Create: `backend/src/sigaa-engine/curriculo-session.ts`
- Test: `backend/src/sigaa-engine/curriculo-session.spec.ts`

**Interfaces:**
- Consumes: `SigaaHttpClient`, `SigaaHttpResponse` from `./session.ts` (already exists).
- Produces:
  ```ts
  class CurriculoPublicSession {
    constructor(http: SigaaHttpClient);
    abrir(path: string): Promise<string>;
    postar(path: string, campos: Record<string, string>): Promise<string>;
  }
  ```
  Consumed by Task 10's `CurriculoService`.

- [ ] **Step 1: Write the failing test**

```ts
import { CurriculoPublicSession } from './curriculo-session';
import type { SigaaHttpClient, SigaaHttpRequest } from './session';

function fakeHttp(
  responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body: string;
  }>,
): SigaaHttpClient & { requests: SigaaHttpRequest[] } {
  const requests: SigaaHttpRequest[] = [];
  let i = 0;
  return {
    requests,
    async request(req) {
      requests.push(req);
      const res = responses[Math.min(i, responses.length - 1)];
      i++;
      return { status: res.status, headers: res.headers ?? {}, body: res.body };
    },
  };
}

const VIEW_STATE_HTML = (vs: string) =>
  `<input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="${vs}" />`;

describe('CurriculoPublicSession', () => {
  it('captures the ViewState and cookie from the opening GET', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/sigaa/public/curso/curriculo.jsf?id=1');
    expect(http.requests[0]).toMatchObject({ method: 'GET' });
  });

  it('throws if postar is called before abrir', async () => {
    const session = new CurriculoPublicSession(fakeHttp([{ status: 200, body: '' }]));
    await expect(session.postar('/x', {})).rejects.toThrow(
      'CurriculoPublicSession.abrir must run before postar',
    );
  });

  it('throws if the opening page carries no ViewState', async () => {
    const http = fakeHttp([{ status: 200, body: '<html></html>' }]);
    const session = new CurriculoPublicSession(http);
    await expect(session.abrir('/x')).rejects.toThrow(
      'SIGAA page carried no ViewState',
    );
  });

  it('sends the captured cookie and ViewState on postar, and updates the ViewState if the response carries a new one', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 200, body: VIEW_STATE_HTML('j_id2') },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await session.postar('/y', { foo: 'bar' });

    expect(http.requests[1]).toMatchObject({
      method: 'POST',
      path: '/y',
      cookie: 'JSESSIONID=ABC123.node1',
      body: { foo: 'bar', 'javax.faces.ViewState': 'j_id1' },
    });

    // a third call must now carry j_id2, proving the response's ViewState
    // was captured and will be sent on the next postar
    await session.postar('/z', {});
    expect(http.requests[2].body).toMatchObject({
      'javax.faces.ViewState': 'j_id2',
    });
  });

  it('leaves the ViewState unchanged when a response carries none — the component-detail response is a stateless leaf and must not reset the conversation', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 200, body: '<html>no view state here</html>' },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await session.postar('/detalhe', {});

    await session.postar('/detalhe-outro', {});
    expect(http.requests[2].body).toMatchObject({
      'javax.faces.ViewState': 'j_id1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curriculo-session.spec.ts`
Expected: FAIL — `Cannot find module './curriculo-session'`.

- [ ] **Step 3: Write the implementation**

```ts
import type { SigaaHttpClient, SigaaHttpResponse } from './session';

const VIEW_STATE_PATTERN = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID_PATTERN = /JSESSIONID=[^;]+/;

/**
 * A generalised, curriculo-specific counterpart to the (professores feature's)
 * PublicSigaaSession: that class is hardcoded to a single search endpoint's
 * path and body shape, while resolving a curriculum needs several distinct
 * pages in sequence (curriculo.jsf → resumo_curriculo.jsf for the matrix →
 * resumo_curriculo.jsf again per component). A new small class, not a shared
 * base — same call the professores design itself made about SigaaSession:
 * extract a common base only once a third distinct need shows up.
 *
 * `capture` silently keeps the previous ViewState when a response carries
 * none — measured against the real component-detail page, which renders no
 * `<form>` at all and does not advance the JSF conversation. That is what
 * makes the per-component detail fetches in CurriculoService safe to run in
 * parallel while reusing one ViewState.
 */
export class CurriculoPublicSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;

  constructor(private readonly http: SigaaHttpClient) {}

  async abrir(path: string): Promise<string> {
    const resposta = await this.http.request({ method: 'GET', path });
    this.capture(resposta);
    if (!this.viewState) {
      throw new Error(`SIGAA page carried no ViewState: ${path}`);
    }
    return resposta.body;
  }

  async postar(path: string, campos: Record<string, string>): Promise<string> {
    if (!this.viewState) {
      throw new Error('CurriculoPublicSession.abrir must run before postar');
    }
    const resposta = await this.http.request({
      method: 'POST',
      path,
      cookie: this.jsessionId,
      body: { ...campos, 'javax.faces.ViewState': this.viewState },
    });
    this.capture(resposta);
    return resposta.body;
  }

  private capture(response: SigaaHttpResponse): void {
    const cookie = (response.headers['set-cookie'] ?? '').match(
      JSESSIONID_PATTERN,
    );
    if (cookie) {
      this.jsessionId = cookie[0];
    }
    const viewState = response.body.match(VIEW_STATE_PATTERN);
    if (viewState) {
      this.viewState = viewState[1];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curriculo-session.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sigaa-engine/curriculo-session.ts src/sigaa-engine/curriculo-session.spec.ts
git commit -m "feat(backend): add the ViewState-chained public session for the curriculum catalog"
```

---

### Task 9: `CurriculoRepository` + Prisma implementation

**Files:**
- Create: `backend/src/curriculo/curriculo.repository.ts`
- Create: `backend/src/db/prisma-curriculo.repository.ts`
- Test: `backend/src/db/prisma-curriculo.repository.spec.ts`

**Interfaces:**
- Consumes: `CursoListaItem` (Task 3), `EstruturaResumo`/`ComponenteResumoMatriz` (Task 5), `ComponenteResumoDetalhe` (Task 6), `@prisma/client` models from Task 2.
- Produces:
  ```ts
  export interface ComponenteCurricularSalvo extends ComponenteResumoMatriz, ComponenteResumoDetalhe {}

  export interface EstruturaCurricularSalva {
    idSigaa: string;
    codigo: string;
    anoPeriodoImplementacao: string;
    cargaHorariaTotal: number;
    cargaHorariaObrigatoria: number;
    cargaHorariaOptativaMinima: number;
    cargaHorariaComplementarMinima: number;
    prazoMinimoSemestres: number;
    prazoMedioSemestres: number;
    prazoMaximoSemestres: number;
    fetchedAt: Date;
    componentes: ComponenteCurricularSalvo[];
  }

  export interface CurriculoRepository {
    buscarCursos(): Promise<CursoListaItem[]>;
    salvarCursos(cursos: CursoListaItem[]): Promise<void>;
    buscarCursoPorId(idSigaa: string): Promise<CursoListaItem | null>;
    buscarEstrutura(cursoId: string): Promise<EstruturaCurricularSalva | null>;
    salvarEstrutura(
      cursoId: string,
      idSigaa: string,
      codigo: string,
      resumo: EstruturaResumo,
      componentesDetalhados: ComponenteCurricularSalvo[],
      staleAfter: Date,
    ): Promise<void>;
  }
  ```
  Consumed by Task 10's `CurriculoService`.

- [ ] **Step 1: Write the interface**

Create `backend/src/curriculo/curriculo.repository.ts`:

```ts
import type { ComponenteResumoMatriz, EstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import type { ComponenteResumoDetalhe } from '../sigaa-engine/parsers/componente-resumo';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';

export interface ComponenteCurricularSalvo
  extends ComponenteResumoMatriz,
    ComponenteResumoDetalhe {}

export interface EstruturaCurricularSalva {
  idSigaa: string;
  codigo: string;
  anoPeriodoImplementacao: string;
  cargaHorariaTotal: number;
  cargaHorariaObrigatoria: number;
  cargaHorariaOptativaMinima: number;
  cargaHorariaComplementarMinima: number;
  prazoMinimoSemestres: number;
  prazoMedioSemestres: number;
  prazoMaximoSemestres: number;
  fetchedAt: Date;
  componentes: ComponenteCurricularSalvo[];
}

export interface CurriculoRepository {
  /** Empty array means the directory has never been populated. */
  buscarCursos(): Promise<CursoListaItem[]>;
  /** Wholesale replace — see the module's Global Constraints on why. */
  salvarCursos(cursos: CursoListaItem[]): Promise<void>;
  buscarCursoPorId(idSigaa: string): Promise<CursoListaItem | null>;
  /** Null means this course's curriculum has never been resolved, or resolved and since evicted. */
  buscarEstrutura(cursoId: string): Promise<EstruturaCurricularSalva | null>;
  /** Wholesale replace of this course's structure + all its componentes. */
  salvarEstrutura(
    cursoId: string,
    idSigaa: string,
    codigo: string,
    resumo: EstruturaResumo,
    componentesDetalhados: ComponenteCurricularSalvo[],
    staleAfter: Date,
  ): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test for the Prisma implementation**

Create `backend/src/db/prisma-curriculo.repository.spec.ts`. This is an integration test against the real test database, following the same pattern as `prisma-historico.repository.spec.ts` — check that file's setup (`beforeEach` truncation, `PrismaService` instantiation) and mirror it exactly:

```ts
import { PrismaCurriculoRepository } from './prisma-curriculo.repository';
import { PrismaService } from './prisma.service';
import type { EstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import type { ComponenteCurricularSalvo } from '../curriculo/curriculo.repository';

describe('PrismaCurriculoRepository', () => {
  const prisma = new PrismaService();
  const repo = new PrismaCurriculoRepository(prisma);

  beforeEach(async () => {
    await prisma.componenteCurricular.deleteMany();
    await prisma.estruturaCurricular.deleteMany();
    await prisma.curso.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('round-trips the course directory, replacing it wholesale', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
      { idSigaa: '2', nome: 'CURSO B', sede: 'SALVADOR', nivel: 'G' },
    ]);
    await repo.salvarCursos([
      { idSigaa: '3', nome: 'CURSO C', sede: 'SALVADOR', nivel: 'G' },
    ]);

    const cursos = await repo.buscarCursos();
    expect(cursos).toEqual([
      { idSigaa: '3', nome: 'CURSO C', sede: 'SALVADOR', nivel: 'G' },
    ]);
  });

  it('finds a single course by id', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);
    expect(await repo.buscarCursoPorId('1')).toEqual({
      idSigaa: '1',
      nome: 'CURSO A',
      sede: 'SALVADOR',
      nivel: 'G',
    });
    expect(await repo.buscarCursoPorId('nao-existe')).toBeNull();
  });

  it('round-trips a curriculum structure with its componentes', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);

    const resumo: EstruturaResumo = {
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 3610,
      cargaHorariaObrigatoria: 3150,
      cargaHorariaOptativaMinima: 360,
      cargaHorariaComplementarMinima: 100,
      prazoMinimoSemestres: 12,
      prazoMedioSemestres: 12,
      prazoMaximoSemestres: 18,
      componentes: [
        {
          idSigaa: '34997',
          codigo: 'FISD36',
          nome: 'FÍSICA GERAL TEÓRICA I',
          cargaHoraria: 60,
          natureza: 'OBRIGATORIA',
          periodo: 1,
        },
      ],
    };
    const componentesDetalhados: ComponenteCurricularSalvo[] = [
      {
        ...resumo.componentes[0],
        unidadeResponsavel: 'DEPARTAMENTO DE FÍSICA GERAL/IFIS',
        preRequisito: null,
        coRequisito: null,
        equivalencias: '( FIS121 )',
      },
    ];
    const staleAfter = new Date('2026-09-19T00:00:00Z');

    await repo.salvarEstrutura('1', 'e1', 'G20251', resumo, componentesDetalhados, staleAfter);

    const salva = await repo.buscarEstrutura('1');
    expect(salva?.codigo).toBe('G20251');
    expect(salva?.cargaHorariaTotal).toBe(3610);
    expect(salva?.componentes).toHaveLength(1);
    expect(salva?.componentes[0]).toMatchObject({
      codigo: 'FISD36',
      preRequisito: null,
      equivalencias: '( FIS121 )',
    });
  });

  it('replaces a structure wholesale on re-resolution, dropping componentes no longer in the matrix', async () => {
    await repo.salvarCursos([
      { idSigaa: '1', nome: 'CURSO A', sede: 'SALVADOR', nivel: 'G' },
    ]);
    const baseResumo: EstruturaResumo = {
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      componentes: [
        {
          idSigaa: '1',
          codigo: 'AAA000',
          nome: 'MATÉRIA ANTIGA',
          cargaHoraria: 60,
          natureza: 'OBRIGATORIA',
          periodo: 1,
        },
      ],
    };
    await repo.salvarEstrutura('1', 'e1', 'G20251', baseResumo, [
      { ...baseResumo.componentes[0], unidadeResponsavel: null, preRequisito: null, coRequisito: null, equivalencias: null },
    ], new Date());

    const novoResumo: EstruturaResumo = { ...baseResumo, componentes: [
      {
        idSigaa: '2',
        codigo: 'BBB000',
        nome: 'MATÉRIA NOVA',
        cargaHoraria: 60,
        natureza: 'OBRIGATORIA',
        periodo: 1,
      },
    ]};
    await repo.salvarEstrutura('1', 'e1', 'G20251', novoResumo, [
      { ...novoResumo.componentes[0], unidadeResponsavel: null, preRequisito: null, coRequisito: null, equivalencias: null },
    ], new Date());

    const salva = await repo.buscarEstrutura('1');
    expect(salva?.componentes.map((c) => c.codigo)).toEqual(['BBB000']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- prisma-curriculo.repository.spec.ts`
Expected: FAIL — `Cannot find module './prisma-curriculo.repository'`.

- [ ] **Step 4: Write the implementation**

```ts
import type {
  Curso as CursoRow,
  EstruturaCurricular as EstruturaRow,
  ComponenteCurricular as ComponenteRow,
} from '@prisma/client';
import type {
  ComponenteCurricularSalvo,
  CurriculoRepository,
  EstruturaCurricularSalva,
} from '../curriculo/curriculo.repository';
import type { EstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import { PrismaService } from './prisma.service';

function cursoParaDominio(row: CursoRow): CursoListaItem {
  return { idSigaa: row.idSigaa, nome: row.nome, sede: row.sede, nivel: row.nivel };
}

function estruturaParaDominio(
  row: EstruturaRow & { componentes: ComponenteRow[] },
): EstruturaCurricularSalva {
  return {
    idSigaa: row.idSigaa,
    codigo: row.codigo,
    anoPeriodoImplementacao: row.anoPeriodoImplementacao,
    cargaHorariaTotal: row.cargaHorariaTotal,
    cargaHorariaObrigatoria: row.cargaHorariaObrigatoria,
    cargaHorariaOptativaMinima: row.cargaHorariaOptativaMinima,
    cargaHorariaComplementarMinima: row.cargaHorariaComplementarMinima,
    prazoMinimoSemestres: row.prazoMinimoSemestres,
    prazoMedioSemestres: row.prazoMedioSemestres,
    prazoMaximoSemestres: row.prazoMaximoSemestres,
    fetchedAt: row.fetchedAt,
    componentes: row.componentes.map((c): ComponenteCurricularSalvo => ({
      idSigaa: c.idSigaa,
      codigo: c.codigo,
      nome: c.nome,
      cargaHoraria: c.cargaHoraria,
      natureza: c.natureza as ComponenteCurricularSalvo['natureza'],
      periodo: c.periodo,
      unidadeResponsavel: c.unidadeResponsavel,
      preRequisito: c.preRequisito,
      coRequisito: c.coRequisito,
      equivalencias: c.equivalencias,
    })),
  };
}

export class PrismaCurriculoRepository implements CurriculoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarCursos(): Promise<CursoListaItem[]> {
    const rows = await this.prisma.curso.findMany();
    return rows.map(cursoParaDominio);
  }

  async salvarCursos(cursos: CursoListaItem[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.curso.deleteMany(),
      this.prisma.curso.createMany({
        data: cursos.map((c) => ({
          idSigaa: c.idSigaa,
          nome: c.nome,
          sede: c.sede,
          nivel: c.nivel,
        })),
      }),
    ]);
  }

  async buscarCursoPorId(idSigaa: string): Promise<CursoListaItem | null> {
    const row = await this.prisma.curso.findUnique({ where: { idSigaa } });
    return row ? cursoParaDominio(row) : null;
  }

  async buscarEstrutura(cursoId: string): Promise<EstruturaCurricularSalva | null> {
    const row = await this.prisma.estruturaCurricular.findFirst({
      where: { cursoId },
      include: { componentes: { orderBy: [{ periodo: 'asc' }, { codigo: 'asc' }] } },
    });
    return row ? estruturaParaDominio(row) : null;
  }

  async salvarEstrutura(
    cursoId: string,
    idSigaa: string,
    codigo: string,
    resumo: EstruturaResumo,
    componentesDetalhados: ComponenteCurricularSalvo[],
    staleAfter: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Componentes cascade off estruturaCurricular, so deleting any prior
      // structure for this curso clears its componentes too.
      await tx.estruturaCurricular.deleteMany({ where: { cursoId } });
      await tx.estruturaCurricular.create({
        data: {
          idSigaa,
          cursoId,
          codigo,
          anoPeriodoImplementacao: resumo.anoPeriodoImplementacao,
          cargaHorariaTotal: resumo.cargaHorariaTotal,
          cargaHorariaObrigatoria: resumo.cargaHorariaObrigatoria,
          cargaHorariaOptativaMinima: resumo.cargaHorariaOptativaMinima,
          cargaHorariaComplementarMinima: resumo.cargaHorariaComplementarMinima,
          prazoMinimoSemestres: resumo.prazoMinimoSemestres,
          prazoMedioSemestres: resumo.prazoMedioSemestres,
          prazoMaximoSemestres: resumo.prazoMaximoSemestres,
          staleAfter,
          componentes: {
            create: componentesDetalhados.map((c) => ({
              idSigaa: c.idSigaa,
              codigo: c.codigo,
              nome: c.nome,
              cargaHoraria: c.cargaHoraria,
              natureza: c.natureza,
              periodo: c.periodo,
              unidadeResponsavel: c.unidadeResponsavel,
              preRequisito: c.preRequisito,
              coRequisito: c.coRequisito,
              equivalencias: c.equivalencias,
            })),
          },
        },
      });
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- prisma-curriculo.repository.spec.ts`
Expected: PASS (4 tests). Requires the test database to be running — same precondition as every other `prisma-*.repository.spec.ts` in this codebase.

- [ ] **Step 6: Commit**

```bash
git add src/curriculo/curriculo.repository.ts src/db/prisma-curriculo.repository.ts src/db/prisma-curriculo.repository.spec.ts
git commit -m "feat(backend): add the curriculum catalog repository"
```

---

### Task 10: `CurriculoService`

**Files:**
- Create: `backend/src/curriculo/curriculo.service.ts`
- Test: `backend/src/curriculo/curriculo.service.spec.ts`

**Interfaces:**
- Consumes: `CurriculoRepository` (Task 9), `parseCursoLista` (Task 3), `parseCursoEstruturas` (Task 4), `parseEstruturaResumo` (Task 5), `parseComponenteResumo` (Task 6), `CurriculoPublicSession` (Task 8), `calcularStaleAfter` (Task 7).
- Produces:
  ```ts
  export class SemEstruturaAtivaError extends Error {}

  export class CurriculoService {
    constructor(
      http: SigaaHttpClient,
      repository: CurriculoRepository,
      agora: () => Date,
    );
    listarCursos(): Promise<CursoListaItem[]>;
    resolverCurso(cursoId: string): Promise<EstruturaCurricularSalva>;
    resolverPorNomeUsuario(nomeCurso: string): Promise<EstruturaCurricularSalva>;
  }
  ```
  Consumed by Task 11's `CurriculoController`.

- [ ] **Step 1: Write the failing test**

```ts
import { CurriculoService, SemEstruturaAtivaError } from './curriculo.service';
import type { CurriculoRepository } from './curriculo.repository';
import type { SigaaHttpClient } from '../sigaa-engine/session';

function fakeRepository(
  overrides: Partial<CurriculoRepository> = {},
): jest.Mocked<CurriculoRepository> {
  return {
    buscarCursos: jest.fn().mockResolvedValue([]),
    salvarCursos: jest.fn().mockResolvedValue(undefined),
    buscarCursoPorId: jest.fn().mockResolvedValue(null),
    buscarEstrutura: jest.fn().mockResolvedValue(null),
    salvarEstrutura: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// A minimal fake HTTP client that answers each request from a path→body map,
// so the parsers run against real (fixture-derived) markup rather than mocks.
function fakeHttp(porPath: Record<string, string>): SigaaHttpClient {
  return {
    async request(req) {
      for (const [pattern, body] of Object.entries(porPath)) {
        if (req.path.includes(pattern)) {
          return { status: 200, headers: {}, body };
        }
      }
      throw new Error(`no fake response registered for ${req.path}`);
    },
  };
}

const LISTA_HTML = `
  <table class="listagem"><tr>
    <td>ENGENHARIA DA COMPUTAÇÃO</td><td>SALVADOR</td>
    <td><a href="portal.jsf?id=1876880&lc=pt_BR&nivel=G" title="Visualizar Página do Curso"></a></td>
  </tr></table>`;

describe('CurriculoService', () => {
  const agora = () => new Date('2026-01-01T00:00:00Z');

  it('refreshes the course directory when empty and returns it', async () => {
    const repository = fakeRepository();
    const service = new CurriculoService(fakeHttp({ 'lista.jsf': LISTA_HTML }), repository, agora);

    const cursos = await service.listarCursos();

    expect(repository.salvarCursos).toHaveBeenCalledWith([
      { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
    ]);
    expect(cursos).toEqual([
      { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
    ]);
  });

  it('does not refresh the directory when it already has rows', async () => {
    const repository = fakeRepository({
      buscarCursos: jest
        .fn()
        .mockResolvedValue([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    await service.listarCursos();

    expect(repository.salvarCursos).not.toHaveBeenCalled();
  });

  it('serves a fresh cached estrutura without touching SIGAA', async () => {
    const cached = {
      idSigaa: 'e1',
      codigo: 'G20251',
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      fetchedAt: new Date('2025-12-01T00:00:00Z'),
      staleAfter: new Date('2026-06-01T00:00:00Z'),
      componentes: [],
    };
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
      buscarEstrutura: jest.fn().mockResolvedValue(cached),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    const resolvido = await service.resolverCurso('1');

    expect(resolvido).toEqual(cached);
  });

  it('throws SemEstruturaAtivaError, writing nothing, when no structure is marked Ativa', async () => {
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
    });
    const ESTRUTURAS_SEM_ATIVA = `
      <table id="table_lt"><tr class="linha_par">
        <td>Detalhes da Estrutura Curricular T20252, Criado em  2025</td>
        <td>Inativa</td>
        <td><a title="Visualizar Estrutura Curricular" onclick="jsfcljs(f,{'x':'x','id':'1'},'')"></a></td>
      </tr></table>`;
    const service = new CurriculoService(
      fakeHttp({ 'curriculo.jsf': ESTRUTURAS_SEM_ATIVA }),
      repository,
      agora,
    );

    await expect(service.resolverCurso('1')).rejects.toThrow(SemEstruturaAtivaError);
    expect(repository.salvarEstrutura).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- curriculo.service.spec.ts`
Expected: FAIL — `Cannot find module './curriculo.service'`.

- [ ] **Step 3: Write the implementation**

```ts
import { Logger } from '@nestjs/common';
import { CurriculoPublicSession } from '../sigaa-engine/curriculo-session';
import type { SigaaHttpClient } from '../sigaa-engine/session';
import { parseCursoLista, type CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import { parseCursoEstruturas } from '../sigaa-engine/parsers/curso-estruturas';
import { parseEstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import { parseComponenteResumo } from '../sigaa-engine/parsers/componente-resumo';
import type {
  ComponenteCurricularSalvo,
  CurriculoRepository,
  EstruturaCurricularSalva,
} from './curriculo.repository';
import { calcularStaleAfter } from './stale';

const LISTA_PATH = '/sigaa/public/curso/lista.jsf';
const CURRICULO_PATH = '/sigaa/public/curso/curriculo.jsf';
const RESUMO_PATH = '/sigaa/public/curso/resumo_curriculo.jsf';
const CONCORRENCIA_COMPONENTES = 4;

export class SemEstruturaAtivaError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} has no "Ativa" curriculum structure`);
  }
}

export class CursoDesconhecidoError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} is not in the directory`);
  }
}

async function withLimitedConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await run(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class CurriculoService {
  private readonly logger = new Logger(CurriculoService.name);

  constructor(
    private readonly http: SigaaHttpClient,
    private readonly repository: CurriculoRepository,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Refreshes the directory only when it has never been populated. */
  async listarCursos(): Promise<CursoListaItem[]> {
    const existentes = await this.repository.buscarCursos();
    if (existentes.length > 0) {
      return existentes;
    }
    const resposta = await this.http.request({ method: 'GET', path: LISTA_PATH });
    if (resposta.status !== 200) {
      throw new Error(`lista.jsf → ${resposta.status}`);
    }
    const cursos = parseCursoLista(resposta.body);
    await this.repository.salvarCursos(cursos);
    return cursos;
  }

  /**
   * Resolves and persists a course's active curriculum structure. Serves the
   * cached row as-is when it exists — this method does not check staleness
   * itself; that is the caller's call (a stale row is still a valid answer,
   * per the design spec's invalidation rule of "served anyway").
   */
  async resolverCurso(cursoId: string): Promise<EstruturaCurricularSalva> {
    const jaSalva = await this.repository.buscarEstrutura(cursoId);
    if (jaSalva) {
      return jaSalva;
    }

    const curso = await this.repository.buscarCursoPorId(cursoId);
    if (!curso) {
      throw new CursoDesconhecidoError(cursoId);
    }

    const session = new CurriculoPublicSession(this.http);
    const listaHtml = await session.abrir(`${CURRICULO_PATH}?lc=pt_BR&id=${cursoId}`);
    const estruturas = parseCursoEstruturas(listaHtml);
    const ativa = estruturas.find((e) => e.ativa);
    if (!ativa) {
      throw new SemEstruturaAtivaError(cursoId);
    }

    const matrizHtml = await session.postar(CURRICULO_PATH, ativa.jsfParams);
    const resumo = parseEstruturaResumo(matrizHtml);

    const componentesDetalhados = await withLimitedConcurrency(
      resumo.componentes,
      CONCORRENCIA_COMPONENTES,
      async (componente): Promise<ComponenteCurricularSalvo> => {
        try {
          const detalheHtml = await session.postar(RESUMO_PATH, {
            formulario: 'formulario',
            id: componente.idSigaa,
            publico: 'public',
          });
          return { ...componente, ...parseComponenteResumo(detalheHtml) };
        } catch (erro) {
          this.logger.warn(
            `Falha ao buscar detalhe do componente ${componente.codigo}: ${erro}`,
          );
          return {
            ...componente,
            unidadeResponsavel: null,
            preRequisito: null,
            coRequisito: null,
            equivalencias: null,
          };
        }
      },
    );

    await this.repository.salvarEstrutura(
      cursoId,
      ativa.jsfParams.id,
      ativa.codigo,
      resumo,
      componentesDetalhados,
      calcularStaleAfter(this.agora()),
    );

    const salva = await this.repository.buscarEstrutura(cursoId);
    if (!salva) {
      throw new Error('Estrutura salva mas não encontrada logo depois.');
    }
    return salva;
  }

  /**
   * `User.curso` reads e.g. "ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador" —
   * name, unidade sigla and campus joined by "/" and " - ". Only the name and
   * campus are matched against the directory (the unidade sigla on the
   * profile side does not always agree with lista.jsf's own grouping).
   */
  async resolverPorNomeUsuario(nomeCurso: string): Promise<EstruturaCurricularSalva> {
    const [antesDoTraco] = nomeCurso.split(' - ');
    const [nome] = antesDoTraco.split('/');
    const campus = nomeCurso.split(' - ')[1]?.trim();

    const cursos = await this.listarCursos();
    const normalizado = (s: string) => s.trim().toUpperCase();
    const encontrado = cursos.find(
      (c) =>
        normalizado(c.nome) === normalizado(nome) &&
        c.nivel === 'G' &&
        (!campus || normalizado(c.sede) === normalizado(campus)),
    );
    if (!encontrado) {
      throw new CursoDesconhecidoError(nomeCurso);
    }
    return this.resolverCurso(encontrado.idSigaa);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- curriculo.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/curriculo/curriculo.service.ts src/curriculo/curriculo.service.spec.ts
git commit -m "feat(backend): add CurriculoService — on-demand resolution and caching"
```

---

### Task 11: `CurriculoController` + module wiring

**Files:**
- Create: `backend/src/curriculo/curriculo.controller.ts`
- Create: `backend/src/curriculo/curriculo.module.ts`
- Test: `backend/src/curriculo/curriculo.controller.spec.ts`
- Modify: `backend/src/db/tokens.ts`
- Modify: `backend/src/db/database.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `CurriculoService` (Task 10), `JwtAuthGuard`/`CurrentUser`/`RequestUser` (existing, from `auth/`), `createSigaaHttpClient` (existing).
- Produces: `GET /curriculo/cursos`, `GET /curriculo/cursos/:cursoId`, `GET /curriculo/meu-curso` — the module's public surface, ready for a future mobile consumer (roadmap items 4/5/8).

- [ ] **Step 1: Add the DI token**

In `backend/src/db/tokens.ts`, add:

```ts
export const CURRICULO_REPOSITORY = Symbol('CURRICULO_REPOSITORY');
```

- [ ] **Step 2: Wire the repository into `DatabaseModule`**

In `backend/src/db/database.module.ts`, add the import and provider/export entries following the exact shape the `DOCENTE_REPOSITORY` entry already uses:

```ts
import { PrismaCurriculoRepository } from './prisma-curriculo.repository';
// ...
import {
  AUDIT_LOGGER,
  CURRICULO_REPOSITORY,
  DOCENTE_REPOSITORY,
  HISTORICO_REPOSITORY,
  SCHEDULE_REPOSITORY,
  SIGAA_LINK_REPOSITORY,
  USER_REPOSITORY,
} from './tokens';

// inside providers: [...]
{
  provide: CURRICULO_REPOSITORY,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService) => new PrismaCurriculoRepository(prisma),
},

// inside exports: [...]
CURRICULO_REPOSITORY,
```

- [ ] **Step 3: Write the failing controller test**

```ts
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurriculoController } from './curriculo.controller';
import { CURRICULO_SERVICE } from './tokens';
import type { CurriculoService } from './curriculo.service';

describe('CurriculoController', () => {
  let app: INestApplication;
  const service: jest.Mocked<Pick<CurriculoService, 'listarCursos' | 'resolverCurso' | 'resolverPorNomeUsuario'>> = {
    listarCursos: jest.fn(),
    resolverCurso: jest.fn(),
    resolverPorNomeUsuario: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CurriculoController],
      providers: [{ provide: CURRICULO_SERVICE, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx) => {
        ctx.switchToHttp().getRequest().user = { userId: 'u1' };
        return true;
      } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('GET /curriculo/cursos returns the directory', async () => {
    service.listarCursos.mockResolvedValue([
      { idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' },
    ]);
    const res = await request(app.getHttpServer()).get('/curriculo/cursos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]);
  });

  it('GET /curriculo/cursos/:cursoId returns the resolved structure', async () => {
    service.resolverCurso.mockResolvedValue({ codigo: 'G20251' } as any);
    const res = await request(app.getHttpServer()).get('/curriculo/cursos/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ codigo: 'G20251' });
    expect(service.resolverCurso).toHaveBeenCalledWith('1');
  });

  it('GET /curriculo/meu-curso resolves against the current user (no user.curso wiring yet — accepts a query param for now)', async () => {
    service.resolverPorNomeUsuario.mockResolvedValue({ codigo: 'G20251' } as any);
    const res = await request(app.getHttpServer())
      .get('/curriculo/meu-curso')
      .query({ curso: 'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador' });
    expect(res.status).toBe(200);
    expect(service.resolverPorNomeUsuario).toHaveBeenCalledWith(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- curriculo.controller.spec.ts`
Expected: FAIL — `Cannot find module './curriculo.controller'` or `'./tokens'`, whichever import Jest resolves first (both are created in Step 5).

- [ ] **Step 5: Add the `CURRICULO_SERVICE` token and write the controller**

Add to `backend/src/curriculo/tokens.ts` (new file, module-local — mirrors the pattern `sigaa-engine/tokens.ts` already uses for its own services):

```ts
export const CURRICULO_SERVICE = Symbol('CURRICULO_SERVICE');
```

Create `backend/src/curriculo/curriculo.controller.ts`:

```ts
import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

/**
 * `/curriculo/meu-curso` takes the course name as a query param for now — it
 * does not yet read `User.curso` off the authenticated user. Wiring that in
 * is for whichever of roadmap items 4/5/8 becomes this endpoint's first real
 * consumer; the resolution logic itself (CurriculoService.resolverPorNomeUsuario)
 * is already what a future wiring would call.
 */
@Controller('curriculo')
@UseGuards(JwtAuthGuard)
export class CurriculoController {
  constructor(
    @Inject(CURRICULO_SERVICE) private readonly service: CurriculoService,
  ) {}

  @Get('cursos')
  async listarCursos(): Promise<CursoListaItem[]> {
    return this.service.listarCursos();
  }

  @Get('cursos/:cursoId')
  async buscarCurso(
    @Param('cursoId') cursoId: string,
  ): Promise<EstruturaCurricularSalva> {
    return this.service.resolverCurso(cursoId);
  }

  @Get('meu-curso')
  async meuCurso(
    @Query('curso') curso: string,
  ): Promise<EstruturaCurricularSalva> {
    return this.service.resolverPorNomeUsuario(curso);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- curriculo.controller.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write `curriculo.module.ts` and wire it into `app.module.ts`**

Create `backend/src/curriculo/curriculo.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { createSigaaHttpClient } from '../sigaa-engine/http-client';
import { DatabaseModule } from '../db/database.module';
import { CURRICULO_REPOSITORY } from '../db/tokens';
import type { CurriculoRepository } from './curriculo.repository';
import { CurriculoController } from './curriculo.controller';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

@Module({
  imports: [DatabaseModule],
  controllers: [CurriculoController],
  providers: [
    {
      provide: CURRICULO_SERVICE,
      inject: [CURRICULO_REPOSITORY],
      useFactory: (repository: CurriculoRepository) =>
        new CurriculoService(createSigaaHttpClient(), repository, () => new Date()),
    },
  ],
})
export class CurriculoModule {}
```

Modify `backend/src/app.module.ts`: add `import { CurriculoModule } from './curriculo/curriculo.module';` and add `CurriculoModule` to the `imports` array, in the same position/style the existing feature modules (e.g. `DocentesModule`, once it lands) are listed.

- [ ] **Step 8: Verify the whole app still boots and all backend tests pass**

Run: `cd backend && npm test`
Expected: PASS, no failures, including every test from Tasks 1–11.

Run: `cd backend && npx nest build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/curriculo/curriculo.controller.ts src/curriculo/curriculo.module.ts \
  src/curriculo/curriculo.controller.spec.ts src/curriculo/tokens.ts \
  src/db/tokens.ts src/db/database.module.ts src/app.module.ts
git commit -m "feat(backend): expose the curriculum catalog API"
```

---

## After this plan

Two things this plan deliberately leaves for later, per the design spec:

1. **No mobile consumer yet.** `GET /curriculo/meu-curso` takes the course name as a query param rather than reading it off `User.curso` server-side — that wiring belongs to whichever of roadmap items 4, 5, or 8 becomes its first real screen.
2. **Pré-requisito/co-requisito/equivalências history-with-vigência** (SIGAA's own `ATIVO`/`DESCONSIDERADO` versioning) is out of scope — only the current-state text is captured. Revisit if a future feature needs to reconstruct "what the rule was on date X".

Once `worktree-professores` merges to `master`, rebase this branch and confirm `CurriculoPublicSession`'s duplication of `PublicSigaaSession`'s capture-cookie/ViewState logic still reads as the right call — if a third near-identical need for a public JSF session shows up after this lands, that is the trigger to extract a shared base (per both features' own stated philosophy), not before.
