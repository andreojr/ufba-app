# Professores Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the student a Professores tab that turns the docente names already on their atestado into the public SIGAA profile nobody knows exists — contact, courses taught, education, Lattes and supervision.

**Architecture:** A new user-less Nest module (`backend/src/docentes/`) resolves a docente name to a `siape` through SIGAA's public JSF search, fetches three public GET pages, and caches the result in two **global** tables (the profile is identical for every student, so the second student in a course costs zero requests). The mobile side adds a list tab whose cards carry identity plus badges saying what is inside, and a detail route for everything else. Parsers follow the existing cheerio + `__fixtures__/*.html` convention in `sigaa-engine/parsers/`.

**Tech Stack:** NestJS, Prisma/PostgreSQL, cheerio, Jest (backend); Expo Router, HeroUI Native, React Native Testing Library, Jest (mobile).

**Spec:** [`docs/superpowers/specs/2026-08-19-professores-design.md`](../specs/2026-08-19-professores-design.md) — read it, plus [`PROFESSORES_INVESTIGATION.md`](../../../PROFESSORES_INVESTIGATION.md) which it assumes.

## Global Constraints

- **Phase 1 only.** No docente photo, no `fotoId`/`fotoKey`/`fotoPath` columns, no bucket, no image proxy. Cards render initials.
- **Current term only.** No docentes from past semesters, no department-wide catalogue sweep.
- **Never persist a third party's name.** Student names appearing in `producao.jsf` are a dedupe key in memory only. Supervised TCCs are stored as `{ titulo, ano }`; supervisions are stored as counts.
- **A miss is written only when the search answered and found nothing.** Network errors, 429s and unexpected 302s must never write `siape: null` into `DocenteLookup`.
- **A missing or invalid `siape` yields HTTP 302, not 404.** Validate on status, never on body.
- **TTL is 30 days ± 3 days of jitter**, stored as a `staleAfter` column at write time, identical for `Docente` and `DocenteLookup`. A stale row is served and revalidated in the background, never awaited.
- **Search POSTs are serial** (the ViewState chains). **Profile GETs are parallel**, capped at 4 concurrent across a request.
- **Search queries are normalised to ASCII** (uppercase, NFD, diacritics stripped, whitespace collapsed) before being sent. SIGAA reads the POST body as ISO-8859-1 and a UTF-8 accent produces a silent 200 with no table and no error.
- Backend tests: `npm test -- <path>` from `backend/`. Mobile tests: `npm test -- <path>` from `mobile/`.
- Backend code and comments in English, matching the existing codebase. User-facing mobile copy in pt-BR.

---

### Task 1: Capture the SIGAA fixtures

No parser can be written test-first without real HTML. This task produces six fixture files and nothing else. The capture script is **throwaway** — it is deleted in the final step, not committed.

All requests are unauthenticated GETs and POSTs against SIGAA's public docente portal (`https://sigaa.ufba.br/sigaa/public/docente/`), the same pages any browser reaches without logging in. No credentials are involved.

**Files:**
- Create (temporary, deleted in step 6): `backend/scripts/capture-docente-fixtures.ts`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-portal-rico.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-portal-vazio.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-disciplinas.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-producao.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-busca-duplicatas.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-busca-vazia.html`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/docente-busca-erro-curto.html`

**Interfaces:**
- Consumes: `createSigaaHttpClient` from `src/sigaa-engine/http-client.ts` (already exists — it decodes every response as ISO-8859-1, which is exactly the string form the parsers will receive at runtime).
- Produces: the seven fixture files above. Every later parser task reads them.

- [ ] **Step 1: Write the capture script**

Create `backend/scripts/capture-docente-fixtures.ts`:

```ts
/**
 * THROWAWAY. Captures the public docente pages once so the parsers can be
 * written test-first. Deleted at the end of Task 1 — PublicSigaaSession
 * (Task 7) is the real, tested implementation of the same handshake.
 *
 * Run: npx ts-node scripts/capture-docente-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSigaaHttpClient } from '../src/sigaa-engine/http-client';

const OUT = join(__dirname, '..', 'src', 'sigaa-engine', 'parsers', '__fixtures__');
const VIEW_STATE = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID = /JSESSIONID=[^;]+/;

const http = createSigaaHttpClient();

function save(name: string, html: string): void {
  writeFileSync(join(OUT, name), html, 'utf-8');
  console.log(`${name}: ${html.length} chars`);
}

async function main(): Promise<void> {
  // --- the three stateless profile GETs -------------------------------
  for (const [name, path] of [
    ['docente-portal-rico.html', '/sigaa/public/docente/portal.jsf?siape=1815041'],
    ['docente-disciplinas.html', '/sigaa/public/docente/disciplinas.jsf?siape=1815041'],
    ['docente-producao.html', '/sigaa/public/docente/producao.jsf?siape=1652496'],
    ['docente-portal-vazio.html', '/sigaa/public/docente/portal.jsf?siape=2042176'],
  ] as const) {
    const res = await http.request({ method: 'GET', path });
    if (res.status !== 200) throw new Error(`${path} → ${res.status}`);
    save(name, res.body);
  }

  // --- the stateful search POSTs --------------------------------------
  const cold = await http.request({
    method: 'GET',
    path: '/sigaa/public/docente/busca_docentes.jsf',
  });
  let cookie = (cold.headers['set-cookie'] ?? '').match(JSESSIONID)?.[0];
  let viewState = cold.body.match(VIEW_STATE)?.[1];
  if (!cookie || !viewState) throw new Error('cold GET gave no cookie/ViewState');

  for (const [name, nome] of [
    ['docente-busca-duplicatas.html', 'APOLINARIO'],
    ['docente-busca-vazia.html', 'LEONCIO'],
    ['docente-busca-erro-curto.html', 'ABC'],
  ] as const) {
    const res = await http.request({
      method: 'POST',
      path: '/sigaa/public/docente/busca_docentes.jsf',
      cookie,
      body: {
        form: 'form',
        'form:nome': nome,
        'form:departamento': '0',
        'form:buscar': 'Buscar',
        'javax.faces.ViewState': viewState,
      },
    });
    if (res.status !== 200) throw new Error(`search ${nome} → ${res.status}`);
    save(name, res.body);
    cookie = (res.headers['set-cookie'] ?? '').match(JSESSIONID)?.[0] ?? cookie;
    viewState = res.body.match(VIEW_STATE)?.[1] ?? viewState;
  }
}

void main();
```

- [ ] **Step 2: Run it**

Run from `backend/`: `npx ts-node scripts/capture-docente-fixtures.ts`

Expected: seven lines of output, each with a non-trivial char count (portal ~7.5k, disciplinas ~52k, producao ~8k, busca-duplicatas large).

- [ ] **Step 3: Verify each fixture is the case it claims to be**

Run from `backend/src/sigaa-engine/parsers/__fixtures__/`:

```bash
grep -c "perfil-docente" docente-portal-rico.html; grep -c "Perfil pessoal n" docente-portal-vazio.html; grep -c "anoPeriodo" docente-disciplinas.html; grep -c "Orienta" docente-producao.html; grep -c "class=\"nome\"" docente-busca-duplicatas.html; grep -c "pelo menos 4 caracteres" docente-busca-erro-curto.html
```

Expected: every count ≥ 1. Additionally open `docente-busca-vazia.html` and confirm it has **no** `table class="listagem"` and **no** error message — a genuine zero-result page, which is what distinguishes it from the error fixture.

If `docente-portal-vazio.html` came back rich (SIGAA profiles do get filled in over time), retry with siape `1055312`, then `2530359`, then `1652496` until one contains `Perfil pessoal não cadastrado`, and use that one.

- [ ] **Step 4: Confirm the profile 302 behaviour still holds**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "https://sigaa.ufba.br/sigaa/public/docente/portal.jsf?siape=1"`

Expected: `302`. This is the assumption Task 7 encodes; if SIGAA now answers 404, note it and adjust `getPaginaPublica` in Task 7 to accept both.

- [ ] **Step 5: Scan the fixtures for third-party personal data**

The producao and busca fixtures contain student and docente names. They are public pages, and the fixtures are needed to test the dedupe, so they are committed as captured — but confirm none of them contains anything beyond what the public page shows (no e-mails of students, no IDs). Read the first 100 lines of `docente-producao.html` to check.

- [ ] **Step 6: Delete the script and commit the fixtures**

```bash
rm backend/scripts/capture-docente-fixtures.ts
git add backend/src/sigaa-engine/parsers/__fixtures__/docente-*.html
git commit -m "test(backend): capture public SIGAA docente fixtures"
```

---

### Task 2: Name normalisation

**Files:**
- Create: `backend/src/sigaa-engine/docente-nome.ts`
- Test: `backend/src/sigaa-engine/docente-nome.spec.ts`

**Interfaces:**
- Produces: `normalizarNomeDocente(nome: string): string` — used by Task 3's candidate filter and Task 9's lookup key.

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/docente-nome.spec.ts`:

```ts
import { normalizarNomeDocente } from './docente-nome';

describe('normalizarNomeDocente', () => {
  it('uppercases, strips diacritics and collapses whitespace', () => {
    expect(normalizarNomeDocente('  Luís   da Paixão  ')).toBe('LUIS DA PAIXAO');
  });

  it('makes the atestado spelling and the registry spelling agree', () => {
    // The registry is not uniform: mixed case and accents both occur.
    expect(normalizarNomeDocente('Clayton Silva de Almeida')).toBe(
      normalizarNomeDocente('CLAYTON SILVA DE ALMEIDA'),
    );
  });

  it('leaves distinct names distinct so a prefix cannot swallow a longer name', () => {
    // Measured: ALINE SILVA ⊂ ALINE SILVA DE MOURA is the one collision in 339.
    expect(normalizarNomeDocente('ALINE SILVA')).not.toBe(
      normalizarNomeDocente('ALINE SILVA DE MOURA'),
    );
  });

  it('produces pure ASCII, which is what makes the ISO-8859-1 POST body safe', () => {
    expect(normalizarNomeDocente('ANDRÉ GUSTAVO SCOLARI CONCEIÇÃO')).toMatch(/^[A-Z ]+$/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/docente-nome.spec.ts`
Expected: FAIL — cannot find module `./docente-nome`.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/docente-nome.ts`:

```ts
/**
 * Canonical form for matching a docente name across two sources that spell it
 * differently: the atestado de matrícula and SIGAA's public registry (which
 * holds accented and mixed-case entries alike).
 *
 * The ASCII output is load-bearing for a second reason: SIGAA reads the search
 * POST body as ISO-8859-1, and a UTF-8 accent comes back as a silent 200 with
 * no results table and no error message. The search itself is
 * accent-insensitive, so normalising costs nothing and removes the hazard.
 */
export function normalizarNomeDocente(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/docente-nome.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/docente-nome.ts backend/src/sigaa-engine/docente-nome.spec.ts
git commit -m "feat(backend): normalise docente names for SIGAA matching"
```

---

### Task 3: `docente-busca` parser

**Files:**
- Create: `backend/src/sigaa-engine/parsers/docente-busca.ts`
- Test: `backend/src/sigaa-engine/parsers/docente-busca.spec.ts`

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces:
  ```ts
  export interface DocenteBuscaResultado { siape: string; nome: string; departamento: string | null }
  export type DocenteBuscaResposta =
    | { tipo: 'resultados'; docentes: DocenteBuscaResultado[] }
    | { tipo: 'erro'; mensagem: string };
  export function parseDocenteBusca(html: string): DocenteBuscaResposta;
  ```
  The union is not stylistic: Task 9 must write a lookup miss for `{ tipo: 'resultados', docentes: [] }` and must **not** write one for `{ tipo: 'erro' }`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/parsers/docente-busca.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteBusca } from './docente-busca';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseDocenteBusca', () => {
  it('extracts siape, nome and departamento from the results table', () => {
    const resposta = parseDocenteBusca(fixture('docente-busca-duplicatas.html'));
    expect(resposta.tipo).toBe('resultados');
    if (resposta.tipo !== 'resultados') return;

    const apolinario = resposta.docentes.find((d) => d.siape === '1815041');
    expect(apolinario).toEqual({
      siape: '1815041',
      nome: 'ANTONIO LOPES APOLINARIO JUNIOR',
      departamento: 'DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC',
    });
  });

  it('dedupes the per-lotação duplicate rows by siape', () => {
    const resposta = parseDocenteBusca(fixture('docente-busca-duplicatas.html'));
    if (resposta.tipo !== 'resultados') throw new Error('expected results');

    const siapes = resposta.docentes.map((d) => d.siape);
    expect(new Set(siapes).size).toBe(siapes.length);
  });

  it('reads a genuine zero-result page as an empty result list, not an error', () => {
    expect(parseDocenteBusca(fixture('docente-busca-vazia.html'))).toEqual({
      tipo: 'resultados',
      docentes: [],
    });
  });

  it('reads the minimum-length complaint as an error, not as zero results', () => {
    const resposta = parseDocenteBusca(fixture('docente-busca-erro-curto.html'));
    expect(resposta.tipo).toBe('erro');
    if (resposta.tipo !== 'erro') return;
    expect(resposta.mensagem).toContain('4 caracteres');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/parsers/docente-busca.spec.ts`
Expected: FAIL — cannot find module `./docente-busca`.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/parsers/docente-busca.ts`:

```ts
import * as cheerio from 'cheerio';

export interface DocenteBuscaResultado {
  siape: string;
  nome: string;
  departamento: string | null;
}

/**
 * Zero results and a rejected query are different facts, and the caller treats
 * them differently: an empty list is grounds for recording "this docente has no
 * public record" for a month, an error never is.
 */
export type DocenteBuscaResposta =
  | { tipo: 'resultados'; docentes: DocenteBuscaResultado[] }
  | { tipo: 'erro'; mensagem: string };

const SIAPE_PATTERN = /siape=(\d+)/;

export function parseDocenteBusca(html: string): DocenteBuscaResposta {
  const $ = cheerio.load(html);

  const erro = $('.erros, .error, ul.erros li').first().text().trim();
  if (erro) {
    return { tipo: 'erro', mensagem: erro };
  }

  // Each docente is listed once per lotação, so the same siape recurs. Keyed by
  // siape, first row wins — the rows are identical apart from the department.
  const porSiape = new Map<string, DocenteBuscaResultado>();

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);
    const href = $row.find('span.pagina a').attr('href') ?? '';
    const siape = href.match(SIAPE_PATTERN)?.[1];
    if (!siape || porSiape.has(siape)) {
      return;
    }
    const nome = $row.find('span.nome').text().trim();
    if (!nome) {
      return;
    }
    const departamento = $row.find('span.departamento').text().trim();
    porSiape.set(siape, { siape, nome, departamento: departamento || null });
  });

  return { tipo: 'resultados', docentes: [...porSiape.values()] };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/parsers/docente-busca.spec.ts`
Expected: PASS, 4 tests.

If the error test fails because the real markup uses a different class, open `docente-busca-erro-curto.html`, find the element actually holding "pelo menos 4 caracteres", and widen the selector in the `erro` line. Do not change the test's assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/docente-busca.*
git commit -m "feat(backend): parse SIGAA's public docente search results"
```

---

### Task 4: `docente-portal` parser

**Files:**
- Create: `backend/src/sigaa-engine/parsers/docente-portal.ts`
- Test: `backend/src/sigaa-engine/parsers/docente-portal.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DocentePortal {
    nome: string | null;
    departamento: string | null;
    unidade: string | null;
    descricaoPessoal: string | null;
    formacao: string[];
    areasInteresse: string[];
    lattesUrl: string | null;
    enderecoProfissional: string | null;
    sala: string | null;
    telefone: string | null;
    email: string | null;
  }
  export function parseDocentePortal(html: string): DocentePortal;
  ```

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/parsers/docente-portal.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocentePortal } from './docente-portal';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseDocentePortal', () => {
  it('reads the contact block, which is the part that is almost always filled', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-rico.html'));
    expect(perfil.sala).toBe('IC- 2012');
    expect(perfil.telefone).toBe('6299');
    expect(perfil.email).toBe('antonio.apolinario@ufba.br');
  });

  it('splits multi-line dd values on <br /> instead of gluing them together', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-rico.html'));
    expect(perfil.areasInteresse.length).toBeGreaterThan(1);
    expect(perfil.areasInteresse.every((a) => a.length > 0)).toBe(true);
    expect(perfil.areasInteresse.join('')).not.toContain('\n');
  });

  it('picks up the Lattes URL', () => {
    expect(parseDocentePortal(fixture('docente-portal-rico.html')).lattesUrl).toMatch(
      /^https?:\/\/lattes\.cnpq\.br\//,
    );
  });

  // The empty profile is the common case — 3 of 4 on a real atestado — so it is
  // the one that must not throw and must not fake data.
  it('returns nulls and empty arrays for a "Perfil pessoal não cadastrado" page', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-vazio.html'));
    expect(perfil.descricaoPessoal).toBeNull();
    expect(perfil.formacao).toEqual([]);
    expect(perfil.areasInteresse).toEqual([]);
    expect(perfil.lattesUrl).toBeNull();
  });

  it('still finds the contact block on an otherwise empty profile', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-vazio.html'));
    expect(perfil.email).not.toBeNull();
  });

  it('degrades to all-null rather than throwing on unrecognised markup', () => {
    expect(() => parseDocentePortal('<html><body>nope</body></html>')).not.toThrow();
    expect(parseDocentePortal('<html><body>nope</body></html>').nome).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/parsers/docente-portal.spec.ts`
Expected: FAIL — cannot find module `./docente-portal`.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/parsers/docente-portal.ts`:

```ts
import * as cheerio from 'cheerio';

/**
 * The public docente profile (`/sigaa/public/docente/portal.jsf?siape=…`).
 *
 * Every field is nullable on purpose. In the measured sample the entire
 * `#perfil-docente` block collapsed to "Perfil pessoal não cadastrado" for 3 of
 * 4 docentes, while `#contato` was filled for 4 of 4 — so an empty profile is
 * the normal outcome, not a parse failure.
 */
export interface DocentePortal {
  nome: string | null;
  departamento: string | null;
  unidade: string | null;
  descricaoPessoal: string | null;
  formacao: string[];
  areasInteresse: string[];
  lattesUrl: string | null;
  enderecoProfissional: string | null;
  sala: string | null;
  telefone: string | null;
  email: string | null;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

/** `<dd>a<br />b</dd>` is two values, not one string with a newline in it. */
function linhas($: cheerio.CheerioAPI, dd: cheerio.Cheerio<never>): string[] {
  return $.html(dd)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => cheerio.load(`<x>${line}</x>`)('x').text().trim())
    .filter((line) => line.length > 0 && line !== 'não informada');
}

function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo && limpo !== 'não informada' ? limpo : null;
}

export function parseDocentePortal(html: string): DocentePortal {
  const $ = cheerio.load(html);

  const perfil: DocentePortal = {
    nome: textoOuNulo($('#left.barra_professor h4, #left .nome').first().text()),
    departamento: null,
    unidade: textoOuNulo($('#left.barra_professor .unidade').first().text()),
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: null,
    telefone: null,
    email: null,
  };

  $('#perfil-docente dl, #contato dl').each((_, dl) => {
    const label = normalizeLabel($(dl).find('dt').first().clone().children('span').remove().end().text());
    const dd = $(dl).find('dd').first() as unknown as cheerio.Cheerio<never>;

    if (label.startsWith('descricao pessoal')) {
      perfil.descricaoPessoal = linhas($, dd).join(' ') || null;
    } else if (label.startsWith('formacao academica')) {
      perfil.formacao = linhas($, dd);
    } else if (label.startsWith('areas de interesse')) {
      perfil.areasInteresse = linhas($, dd);
    } else if (label.startsWith('curriculo lattes')) {
      perfil.lattesUrl = $(dl).find('a').attr('href')?.trim() ?? null;
    } else if (label.startsWith('endereco profissional')) {
      perfil.enderecoProfissional = linhas($, dd).join(', ') || null;
    } else if (label === 'sala') {
      perfil.sala = textoOuNulo($(dl).find('dd').first().text());
    } else if (label.startsWith('telefone')) {
      perfil.telefone = textoOuNulo($(dl).find('dd').first().text());
    } else if (label.startsWith('endereco eletronico')) {
      perfil.email = textoOuNulo($(dl).find('dd').first().text());
    }
  });

  return perfil;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/parsers/docente-portal.spec.ts`
Expected: PASS, 6 tests.

The `#left`/nome/unidade selectors are the least certain part — the investigation names `div#left.barra_professor` but not its inner structure. If the nome assertion fails, open `docente-portal-rico.html`, find the element holding the docente's name, and fix the selector. Add an assertion for `nome` and `unidade` against the real values while you are there.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/docente-portal.*
git commit -m "feat(backend): parse the public docente profile page"
```

---

### Task 5: `docente-disciplinas` parser

**Files:**
- Create: `backend/src/sigaa-engine/parsers/docente-disciplinas.ts`
- Test: `backend/src/sigaa-engine/parsers/docente-disciplinas.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DocenteDisciplina {
    semestre: string;      // "2026.2"
    codigo: string;        // "MATA65"
    nome: string;
    cargaHoraria: number;  // 60, parsed out of "60h"
    horario: string;       // "24T34 (19/08/2026 - 19/12/2026)" — kept verbatim
  }
  export function parseDocenteDisciplinas(html: string): DocenteDisciplina[];
  ```
  `horario` stays a raw string. `schedule-code.ts` already parses this exact format, so the consumer decodes it when it needs slots; storing a pre-parsed shape here would duplicate that module.

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/parsers/docente-disciplinas.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteDisciplinas } from './docente-disciplinas';
import { parseScheduleCode } from '../schedule-code';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'docente-disciplinas.html'),
  'utf-8',
);

describe('parseDocenteDisciplinas', () => {
  it('attaches every row to the anoPeriodo heading above it', () => {
    const disciplinas = parseDocenteDisciplinas(fixture);
    expect(disciplinas.length).toBeGreaterThan(0);
    expect(disciplinas.every((d) => /^\d{4}\.\d$/.test(d.semestre))).toBe(true);
  });

  it('reads codigo, nome and carga horária as a number', () => {
    const primeira = parseDocenteDisciplinas(fixture)[0];
    expect(primeira.codigo).toMatch(/^[A-Z]{3,4}\d{2,3}$/);
    expect(primeira.nome.length).toBeGreaterThan(0);
    expect(Number.isInteger(primeira.cargaHoraria)).toBe(true);
    expect(primeira.cargaHoraria).toBeGreaterThan(0);
  });

  it('keeps the horário verbatim, in the form schedule-code.ts already parses', () => {
    const comHorario = parseDocenteDisciplinas(fixture).find((d) => d.horario.length > 0);
    expect(comHorario).toBeDefined();
    const codigo = comHorario!.horario.split(' ')[0];
    expect(parseScheduleCode(codigo).length).toBeGreaterThan(0);
  });

  it('returns an empty list rather than throwing when there is no listing', () => {
    expect(parseDocenteDisciplinas('<html><body></body></html>')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/parsers/docente-disciplinas.spec.ts`
Expected: FAIL — cannot find module `./docente-disciplinas`.

Before implementing, confirm the exported name of the schedule-code parser: `grep -n "^export" backend/src/sigaa-engine/schedule-code.ts`. If it is not `parseScheduleCode`, fix the import and the call in the test to the real name.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/parsers/docente-disciplinas.ts`:

```ts
import * as cheerio from 'cheerio';

/**
 * "Disciplinas Ministradas" (`/sigaa/public/docente/disciplinas.jsf?siape=…`):
 * a single `table.listagem` where a full-width `td.anoPeriodo` row opens each
 * term and the course rows follow it, newest term first.
 */
export interface DocenteDisciplina {
  semestre: string;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Verbatim, e.g. "24T34 (19/08/2026 - 19/12/2026)" — see schedule-code.ts. */
  horario: string;
}

const SEMESTRE_PATTERN = /^\d{4}\.\d$/;

export function parseDocenteDisciplinas(html: string): DocenteDisciplina[] {
  const $ = cheerio.load(html);
  const disciplinas: DocenteDisciplina[] = [];
  let semestre: string | null = null;

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);

    const cabecalho = $row.find('td.anoPeriodo').first().text().trim();
    if (SEMESTRE_PATTERN.test(cabecalho)) {
      semestre = cabecalho;
      return;
    }

    const codigo = $row.find('td.codigo').first().text().trim();
    if (!semestre || !codigo) {
      return;
    }

    const cargaHoraria = Number.parseInt(
      $row.find('td.ch').first().text().replace(/\D/g, ''),
      10,
    );

    disciplinas.push({
      semestre,
      codigo,
      nome: $row.find('td.codigo').next().text().trim(),
      cargaHoraria: Number.isNaN(cargaHoraria) ? 0 : cargaHoraria,
      horario: $row.find('td.horario').first().text().trim(),
    });
  });

  return disciplinas;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/parsers/docente-disciplinas.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/docente-disciplinas.*
git commit -m "feat(backend): parse a docente's courses-taught history"
```

---

### Task 6: `docente-producao` parser

The hard one. Two measured behaviours drive it: the `<h2>` counts are inflated by duplicate rows, and a TCC title may contain a comma so rows parse **right to left**.

**Files:**
- Create: `backend/src/sigaa-engine/parsers/docente-producao.ts`
- Test: `backend/src/sigaa-engine/parsers/docente-producao.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DocenteProducao {
    tccsOrientados: { titulo: string; ano: number }[];
    orientacoes: {
      mestradoAndamento: number; mestradoConcluidas: number;
      doutoradoAndamento: number; doutoradoConcluidas: number;
    };
  }
  export function parseDocenteProducao(html: string): DocenteProducao;
  ```
  No student name appears in the return type. Names are used as a dedupe key inside the function and discarded.

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/parsers/docente-producao.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteProducao } from './docente-producao';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'docente-producao.html'),
  'utf-8',
);

describe('parseDocenteProducao', () => {
  it('counts fewer supervisions than the inflated <h2> header claims', () => {
    // Measured on siape 1652496: the header says "(42)" but the same
    // supervision (same name, same start, same state) is listed twice.
    const cabecalho = Number.parseInt(
      /Orienta[^(]*\((\d+)\)/.exec(fixture)?.[1] ?? '0',
      10,
    );
    const { orientacoes } = parseDocenteProducao(fixture);
    const total =
      orientacoes.mestradoAndamento +
      orientacoes.mestradoConcluidas +
      orientacoes.doutoradoAndamento +
      orientacoes.doutoradoConcluidas;

    expect(cabecalho).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(cabecalho);
  });

  it('never returns a student name in the supervised-TCC list', () => {
    const { tccsOrientados } = parseDocenteProducao(fixture);
    expect(tccsOrientados.length).toBeGreaterThan(0);
    for (const tcc of tccsOrientados) {
      expect(Object.keys(tcc).sort()).toEqual(['ano', 'titulo']);
      expect(Number.isInteger(tcc.ano)).toBe(true);
    }
  });

  it('keeps a comma inside a TCC title by splitting from the right', () => {
    const html = `<h2>Trabalho de Fim de Curso (1)</h2>
      <table class="listagem"><tr><td>
        Redes neurais, grafos e você, FULANO DE TAL, 03/2024
      </td></tr></table>`;
    expect(parseDocenteProducao(html).tccsOrientados).toEqual([
      { titulo: 'Redes neurais, grafos e você', ano: 2024 },
    ]);
  });

  it('returns zeros and empty lists for a docente with no production', () => {
    expect(parseDocenteProducao('<html><body></body></html>')).toEqual({
      tccsOrientados: [],
      orientacoes: {
        mestradoAndamento: 0,
        mestradoConcluidas: 0,
        doutoradoAndamento: 0,
        doutoradoConcluidas: 0,
      },
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/parsers/docente-producao.spec.ts`
Expected: FAIL — cannot find module `./docente-producao`.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/parsers/docente-producao.ts`:

```ts
import * as cheerio from 'cheerio';

/**
 * "Produção Intelectual" (`/sigaa/public/docente/producao.jsf?siape=…`).
 *
 * The label misleads twice. In every docente measured the only sections present
 * were "Trabalho de Fim de Curso" and "Orientações de Pós-Graduação" — no
 * articles, no books. And "Trabalho de Fim de Curso" is not the docente's own
 * thesis: these are the TCCs they supervised. What the docente themselves
 * studied lives in portal.jsf's "Formação acadêmica" field.
 *
 * Kept because it answers a real question: the titles map what this docente
 * will supervise, and the in-progress counts hint at whether they have room.
 */
export interface DocenteProducao {
  /** No student name, ever — see the dedupe note below. */
  tccsOrientados: { titulo: string; ano: number }[];
  orientacoes: {
    mestradoAndamento: number;
    mestradoConcluidas: number;
    doutoradoAndamento: number;
    doutoradoConcluidas: number;
  };
}

const ANO_PATTERN = /(\d{2})\/(\d{4})\s*$/;

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function linhasDaSecao($: cheerio.CheerioAPI, tituloParcial: string): string[] {
  const alvo = semAcento(tituloParcial);
  const linhas: string[] = [];

  $('h2').each((_, h2) => {
    if (!semAcento($(h2).text()).includes(alvo)) {
      return;
    }
    $(h2)
      .nextAll('table')
      .first()
      .find('tr')
      .each((__, row) => {
        const texto = $(row).text().replace(/\s+/g, ' ').trim();
        if (texto) {
          linhas.push(texto);
        }
      });
  });

  return linhas;
}

export function parseDocenteProducao(html: string): DocenteProducao {
  const $ = cheerio.load(html);

  // --- supervised TCCs: "Título, ALUNO, MM/AAAA" ------------------------
  // Split from the RIGHT: a title may contain commas, the trailing two fields
  // never do. Splitting left-first corrupts every title with a comma in it.
  const tccs: { titulo: string; ano: number }[] = [];
  for (const linha of linhasDaSecao($, 'trabalho de fim de curso')) {
    const ano = ANO_PATTERN.exec(linha);
    if (!ano) {
      continue;
    }
    const semData = linha.slice(0, ano.index).replace(/,\s*$/, '');
    const ultimaVirgula = semData.lastIndexOf(',');
    if (ultimaVirgula < 0) {
      continue;
    }
    // Everything before the student's name is the title. The name itself is
    // dropped here and never leaves this function.
    const titulo = semData.slice(0, ultimaVirgula).trim();
    if (titulo) {
      tccs.push({ titulo, ano: Number.parseInt(ano[2], 10) });
    }
  }

  // --- supervisions: "Nível, Aluno, início - fim, situação" -------------
  // The <h2> count is inflated: the same supervision is listed more than once.
  // Dedupe on the whole normalised line before counting. The student name is a
  // dedupe key in memory only — only the four totals are returned.
  const orientacoes = {
    mestradoAndamento: 0,
    mestradoConcluidas: 0,
    doutoradoAndamento: 0,
    doutoradoConcluidas: 0,
  };

  const vistas = new Set<string>();
  for (const linha of linhasDaSecao($, 'orientacoes de pos-graduacao')) {
    const chave = semAcento(linha);
    if (vistas.has(chave)) {
      continue;
    }
    vistas.add(chave);

    const doutorado = chave.includes('doutorado');
    const mestrado = chave.includes('mestrado');
    if (!doutorado && !mestrado) {
      continue;
    }
    // "Concluída" is the reliable marker; the situação field alone is not —
    // rows exist with an end date and "Orientação em Andamento", and with
    // "Concluída em " and no date.
    const concluida = chave.includes('conclu');

    if (doutorado) {
      if (concluida) orientacoes.doutoradoConcluidas += 1;
      else orientacoes.doutoradoAndamento += 1;
    } else {
      if (concluida) orientacoes.mestradoConcluidas += 1;
      else orientacoes.mestradoAndamento += 1;
    }
  }

  return { tccsOrientados: tccs, orientacoes };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/parsers/docente-producao.spec.ts`
Expected: PASS, 4 tests.

If the section lookup misses because the real markup wraps rows differently (e.g. the rows are `<li>` not `<tr>`, or the table is not the next sibling), open `docente-producao.html`, find how a supervision row is actually marked up, and adjust `linhasDaSecao`. Do not weaken the dedupe assertion — proving the total comes in under the header count is the whole point of this task.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/docente-producao.*
git commit -m "feat(backend): parse docente supervision signals, deduped"
```

---

### Task 7: `PublicSigaaSession`

**Files:**
- Create: `backend/src/sigaa-engine/public-session.ts`
- Test: `backend/src/sigaa-engine/public-session.spec.ts`

**Interfaces:**
- Consumes: `SigaaHttpClient`, `SigaaHttpRequest`, `SigaaHttpResponse` from `./session`.
- Produces:
  ```ts
  export class PublicSigaaSession {
    constructor(http: SigaaHttpClient);
    async iniciar(): Promise<void>;
    async buscar(nome: string): Promise<string>;   // results HTML
  }
  export async function getPaginaPublica(
    http: SigaaHttpClient, path: string,
  ): Promise<string | null>;                        // null on 302 (unknown siape)
  ```

This duplicates ~15 lines of cookie/ViewState handling from `SigaaSession` on purpose. `SigaaSession` is built around login/relogin and is the most critical path in the backend; extracting a shared base to serve a consumer that did not exist yesterday risks the whole app to save fifteen lines. Extract it if a third consumer appears.

- [ ] **Step 1: Write the failing test**

Create `backend/src/sigaa-engine/public-session.spec.ts`:

```ts
import { PublicSigaaSession, getPaginaPublica } from './public-session';
import type { SigaaHttpClient, SigaaHttpRequest, SigaaHttpResponse } from './session';

function fakeHttp(responses: SigaaHttpResponse[]): {
  http: SigaaHttpClient;
  requests: SigaaHttpRequest[];
} {
  const requests: SigaaHttpRequest[] = [];
  let i = 0;
  return {
    requests,
    http: {
      request(req) {
        requests.push(req);
        const response = responses[i++];
        if (!response) throw new Error('fake http ran out of responses');
        return Promise.resolve(response);
      },
    },
  };
}

function pagina(viewState: string, corpo = ''): SigaaHttpResponse {
  return {
    status: 200,
    headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/' },
    body: `${corpo}<input name="javax.faces.ViewState" value="${viewState}" />`,
  };
}

describe('PublicSigaaSession', () => {
  it('seeds cookie and ViewState from a cold GET before searching', async () => {
    const { http, requests } = fakeHttp([pagina('j_id1'), pagina('j_id2', '<table/>')]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('APOLINARIO');

    expect(requests[0].method).toBe('GET');
    expect(requests[1].method).toBe('POST');
    expect(requests[1].cookie).toBe('JSESSIONID=abc123');
    expect(requests[1].body?.['javax.faces.ViewState']).toBe('j_id1');
  });

  it('chains the ViewState across consecutive searches', async () => {
    const { http, requests } = fakeHttp([
      pagina('j_id1'),
      pagina('j_id2'),
      pagina('j_id3'),
    ]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('PRIMEIRO');
    await session.buscar('SEGUNDO');

    expect(requests[1].body?.['javax.faces.ViewState']).toBe('j_id1');
    expect(requests[2].body?.['javax.faces.ViewState']).toBe('j_id2');
  });

  it('sends the departamento-agnostic form SIGAA expects', async () => {
    const { http, requests } = fakeHttp([pagina('j_id1'), pagina('j_id2')]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('APOLINARIO');

    expect(requests[1].body).toMatchObject({
      form: 'form',
      'form:nome': 'APOLINARIO',
      'form:departamento': '0',
      'form:buscar': 'Buscar',
    });
  });

  it('refuses to search before iniciar, rather than posting cold and getting a 302', async () => {
    const { http } = fakeHttp([]);
    await expect(new PublicSigaaSession(http).buscar('X')).rejects.toThrow(/iniciar/);
  });
});

describe('getPaginaPublica', () => {
  it('returns the body on 200', async () => {
    const { http } = fakeHttp([{ status: 200, headers: {}, body: '<html>ok</html>' }]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1815041'),
    ).resolves.toBe('<html>ok</html>');
  });

  // An unknown siape answers 302, never 404 — validate on status, not body.
  it('returns null on the 302 an unknown siape produces', async () => {
    const { http } = fakeHttp([
      { status: 302, headers: { location: '/sigaa/public/home.jsf' }, body: '' },
    ]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1'),
    ).resolves.toBeNull();
  });

  it('throws on an unexpected status so the caller does not record a false miss', async () => {
    const { http } = fakeHttp([{ status: 500, headers: {}, body: '' }]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1815041'),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/sigaa-engine/public-session.spec.ts`
Expected: FAIL — cannot find module `./public-session`.

- [ ] **Step 3: Implement**

Create `backend/src/sigaa-engine/public-session.ts`:

```ts
import { normalizarNomeDocente } from './docente-nome';
import type { SigaaHttpClient, SigaaHttpResponse } from './session';

const BUSCA_PATH = '/sigaa/public/docente/busca_docentes.jsf';
const VIEW_STATE_PATTERN = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID_PATTERN = /JSESSIONID=[^;]+/;

/**
 * SIGAA's public docente portal needs a JSF session for the *search* only — a
 * cold POST answers 302. The profile pages themselves are stateless GETs (see
 * getPaginaPublica below).
 *
 * Deliberately separate from SigaaSession rather than a mode of it: that class
 * exists to manage login, relogin and credentials, none of which apply here,
 * and it is the path every authenticated feature depends on.
 */
export class PublicSigaaSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;

  constructor(private readonly http: SigaaHttpClient) {}

  async iniciar(): Promise<void> {
    const inicial = await this.http.request({ method: 'GET', path: BUSCA_PATH });
    this.capture(inicial);
    if (!this.viewState) {
      throw new Error('SIGAA public search page carried no ViewState');
    }
  }

  async buscar(nome: string): Promise<string> {
    if (!this.viewState) {
      throw new Error('PublicSigaaSession.iniciar must run before buscar');
    }

    const resposta = await this.http.request({
      method: 'POST',
      path: BUSCA_PATH,
      cookie: this.jsessionId,
      body: {
        form: 'form',
        // ASCII only: SIGAA reads this body as ISO-8859-1 and a UTF-8 accent
        // comes back as a silent 200 with no table and no error message.
        'form:nome': normalizarNomeDocente(nome),
        'form:departamento': '0',
        'form:buscar': 'Buscar',
        'javax.faces.ViewState': this.viewState,
      },
    });
    this.capture(resposta);
    return resposta.body;
  }

  private capture(response: SigaaHttpResponse): void {
    const cookie = (response.headers['set-cookie'] ?? '').match(JSESSIONID_PATTERN);
    if (cookie) {
      this.jsessionId = cookie[0];
    }
    const viewState = response.body.match(VIEW_STATE_PATTERN);
    if (viewState) {
      this.viewState = viewState[1];
    }
  }
}

/**
 * A stateless public GET. An unknown or missing siape answers 302 (not 404), so
 * a redirect means "no such docente" and is reported as null; anything else
 * unexpected throws, because the caller must not record a false "no public
 * record" for what is really an outage.
 */
export async function getPaginaPublica(
  http: SigaaHttpClient,
  path: string,
): Promise<string | null> {
  const response = await http.request({ method: 'GET', path });
  if (response.status === 302) {
    return null;
  }
  if (response.status !== 200) {
    throw new Error(`Unexpected status ${response.status} for ${path}`);
  }
  return response.body;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/sigaa-engine/public-session.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/public-session.*
git commit -m "feat(backend): add an unauthenticated SIGAA session for the docente portal"
```

---

### Task 8: Prisma models, migration and repository

**Files:**
- Modify: `backend/prisma/schema.prisma` (append two models)
- Create: `backend/src/docentes/docente.repository.ts` (interface + token)
- Create: `backend/src/db/prisma-docente.repository.ts`
- Modify: `backend/src/db/tokens.ts` (add `DOCENTE_REPOSITORY`)
- Modify: `backend/src/db/database.module.ts` (provide and export it)
- Create: `backend/src/docentes/stale.ts`
- Test: `backend/src/docentes/stale.spec.ts`

**Interfaces:**
- Consumes: `DocenteDisciplina` (Task 5), `DocenteProducao` (Task 6).
- Produces:
  ```ts
  export interface DocenteSalvo {
    siape: string; nome: string; departamento: string | null; unidade: string | null;
    descricaoPessoal: string | null; formacao: string[]; areasInteresse: string[];
    lattesUrl: string | null; enderecoProfissional: string | null; sala: string | null;
    telefone: string | null; email: string | null;
    disciplinas: DocenteDisciplina[];
    tccsOrientados: { titulo: string; ano: number }[];
    orientacoes: DocenteProducao['orientacoes'];
    fetchedAt: Date; staleAfter: Date;
  }
  export interface DocenteLookupSalvo {
    nomeNormalizado: string; nomeOriginal: string; siape: string | null; staleAfter: Date;
  }
  export interface DocenteRepository {
    buscarLookups(nomesNormalizados: string[]): Promise<DocenteLookupSalvo[]>;
    buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]>;
    salvarDocente(docente: DocenteSalvo): Promise<void>;
    salvarLookup(lookup: DocenteLookupSalvo): Promise<void>;
  }
  export const DOCENTE_REPOSITORY: symbol;      // exported from src/db/tokens.ts
  export function calcularStaleAfter(agora: Date): Date;   // from ./stale
  ```

- [ ] **Step 1: Write the failing test for the TTL helper**

Create `backend/src/docentes/stale.spec.ts`:

```ts
import { calcularStaleAfter } from './stale';

const DIA = 24 * 60 * 60 * 1000;

describe('calcularStaleAfter', () => {
  it('lands 30 days out, give or take three', () => {
    const agora = new Date('2026-08-19T12:00:00Z');
    for (let i = 0; i < 200; i += 1) {
      const delta = calcularStaleAfter(agora).getTime() - agora.getTime();
      expect(delta).toBeGreaterThanOrEqual(27 * DIA);
      expect(delta).toBeLessThanOrEqual(33 * DIA);
    }
  });

  // A term's docentes are all resolved in one burst, so a fixed TTL would expire
  // them in one burst too and dump every resync onto whoever crosses the line.
  it('spreads expiries instead of stacking them on one date', () => {
    const agora = new Date('2026-08-19T12:00:00Z');
    const valores = new Set(
      Array.from({ length: 50 }, () => calcularStaleAfter(agora).getTime()),
    );
    expect(valores.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/docentes/stale.spec.ts`
Expected: FAIL — cannot find module `./stale`.

- [ ] **Step 3: Implement the TTL helper**

Create `backend/src/docentes/stale.ts`:

```ts
const DIA_MS = 24 * 60 * 60 * 1000;
const TTL_DIAS = 30;
const JITTER_DIAS = 3;

/**
 * When a freshly written row should next be resynced.
 *
 * Computed at write time, not at read time: a jitter re-rolled on every read
 * would make the same row flip between fresh and stale. Stored in a column so
 * the policy is inspectable in the database instead of hidden in a formula.
 *
 * The jitter matters because a term's docentes are all resolved in one burst.
 * With a flat 30 days they would all expire on the same afternoon and the first
 * screen open past that line would pay every resync at once.
 */
export function calcularStaleAfter(agora: Date): Date {
  const jitter = (Math.random() * 2 - 1) * JITTER_DIAS * DIA_MS;
  return new Date(agora.getTime() + TTL_DIAS * DIA_MS + jitter);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/docentes/stale.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the Prisma models**

Append to `backend/prisma/schema.prisma`:

```prisma
// Global — NOT a per-user cache like CachedGrade/CachedSchedule. The public
// profile is identical for every student, so the second student enrolled with
// this docente costs zero SIGAA requests.
model Docente {
  siape        String  @id
  nome         String
  departamento String?
  unidade      String?

  // portal.jsf #perfil-docente — absent in 3 of 4 in the measured sample.
  descricaoPessoal String?  @map("descricao_pessoal")
  formacao         String[] @default([])
  areasInteresse   String[] @default([]) @map("areas_interesse")
  lattesUrl        String?  @map("lattes_url")

  // portal.jsf #contato — filled in 4 of 4, and the part students actually want.
  enderecoProfissional String? @map("endereco_profissional")
  sala                 String?
  telefone             String?
  email                String?

  // [{ semestre, codigo, nome, cargaHoraria, horario }]
  disciplinas Json @default("[]")
  // [{ titulo, ano }] — never a student name.
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
// no public record is not re-searched on every screen open.
model DocenteLookup {
  nomeNormalizado String   @id @map("nome_normalizado")
  nomeOriginal    String   @map("nome_original")
  siape           String?
  resolvedAt      DateTime @default(now()) @map("resolved_at")
  staleAfter      DateTime @map("stale_after")

  @@map("docente_lookup")
}
```

- [ ] **Step 6: Generate the migration**

Run from `backend/`: `npx prisma migrate dev --name add_docentes`

Expected: a new directory under `prisma/migrations/` containing `CREATE TABLE "docentes"` and `CREATE TABLE "docente_lookup"`. Read the generated SQL and confirm neither table has a `user_id` column — if one appeared, the model was written wrong.

- [ ] **Step 7: Write the repository interface**

Create `backend/src/docentes/docente.repository.ts`:

```ts
import type { DocenteDisciplina } from '../sigaa-engine/parsers/docente-disciplinas';
import type { DocenteProducao } from '../sigaa-engine/parsers/docente-producao';

export interface DocenteSalvo {
  siape: string;
  nome: string;
  departamento: string | null;
  unidade: string | null;
  descricaoPessoal: string | null;
  formacao: string[];
  areasInteresse: string[];
  lattesUrl: string | null;
  enderecoProfissional: string | null;
  sala: string | null;
  telefone: string | null;
  email: string | null;
  disciplinas: DocenteDisciplina[];
  tccsOrientados: { titulo: string; ano: number }[];
  orientacoes: DocenteProducao['orientacoes'];
  fetchedAt: Date;
  staleAfter: Date;
}

export interface DocenteLookupSalvo {
  nomeNormalizado: string;
  nomeOriginal: string;
  /** Null is a recorded MISS: this name has no public record. */
  siape: string | null;
  staleAfter: Date;
}

export interface DocenteRepository {
  buscarLookups(nomesNormalizados: string[]): Promise<DocenteLookupSalvo[]>;
  buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]>;
  salvarDocente(docente: DocenteSalvo): Promise<void>;
  salvarLookup(lookup: DocenteLookupSalvo): Promise<void>;
}
```

- [ ] **Step 8: Write the Prisma implementation**

Add `export const DOCENTE_REPOSITORY = Symbol('DOCENTE_REPOSITORY');` to `backend/src/db/tokens.ts`.

Create `backend/src/db/prisma-docente.repository.ts`:

```ts
import type { Docente as DocenteRow, DocenteLookup as LookupRow } from '@prisma/client';
import type {
  DocenteLookupSalvo,
  DocenteRepository,
  DocenteSalvo,
} from '../docentes/docente.repository';
import type { DocenteDisciplina } from '../sigaa-engine/parsers/docente-disciplinas';
import { PrismaService } from './prisma.service';

function paraDominio(row: DocenteRow): DocenteSalvo {
  return {
    siape: row.siape,
    nome: row.nome,
    departamento: row.departamento,
    unidade: row.unidade,
    descricaoPessoal: row.descricaoPessoal,
    formacao: row.formacao,
    areasInteresse: row.areasInteresse,
    lattesUrl: row.lattesUrl,
    enderecoProfissional: row.enderecoProfissional,
    sala: row.sala,
    telefone: row.telefone,
    email: row.email,
    disciplinas: (row.disciplinas ?? []) as unknown as DocenteDisciplina[],
    tccsOrientados: (row.tccsOrientados ?? []) as unknown as {
      titulo: string;
      ano: number;
    }[],
    orientacoes: {
      mestradoAndamento: row.orientacoesMestradoAndamento,
      mestradoConcluidas: row.orientacoesMestradoConcluidas,
      doutoradoAndamento: row.orientacoesDoutoradoAndamento,
      doutoradoConcluidas: row.orientacoesDoutoradoConcluidas,
    },
    fetchedAt: row.fetchedAt,
    staleAfter: row.staleAfter,
  };
}

function lookupParaDominio(row: LookupRow): DocenteLookupSalvo {
  return {
    nomeNormalizado: row.nomeNormalizado,
    nomeOriginal: row.nomeOriginal,
    siape: row.siape,
    staleAfter: row.staleAfter,
  };
}

export class PrismaDocenteRepository implements DocenteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarLookups(nomesNormalizados: string[]): Promise<DocenteLookupSalvo[]> {
    if (nomesNormalizados.length === 0) return [];
    const rows = await this.prisma.docenteLookup.findMany({
      where: { nomeNormalizado: { in: nomesNormalizados } },
    });
    return rows.map(lookupParaDominio);
  }

  async buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]> {
    if (siapes.length === 0) return [];
    const rows = await this.prisma.docente.findMany({ where: { siape: { in: siapes } } });
    return rows.map(paraDominio);
  }

  async salvarDocente(docente: DocenteSalvo): Promise<void> {
    const dados = {
      nome: docente.nome,
      departamento: docente.departamento,
      unidade: docente.unidade,
      descricaoPessoal: docente.descricaoPessoal,
      formacao: docente.formacao,
      areasInteresse: docente.areasInteresse,
      lattesUrl: docente.lattesUrl,
      enderecoProfissional: docente.enderecoProfissional,
      sala: docente.sala,
      telefone: docente.telefone,
      email: docente.email,
      disciplinas: docente.disciplinas as unknown as object,
      tccsOrientados: docente.tccsOrientados as unknown as object,
      orientacoesMestradoAndamento: docente.orientacoes.mestradoAndamento,
      orientacoesMestradoConcluidas: docente.orientacoes.mestradoConcluidas,
      orientacoesDoutoradoAndamento: docente.orientacoes.doutoradoAndamento,
      orientacoesDoutoradoConcluidas: docente.orientacoes.doutoradoConcluidas,
      fetchedAt: docente.fetchedAt,
      staleAfter: docente.staleAfter,
    };
    await this.prisma.docente.upsert({
      where: { siape: docente.siape },
      create: { siape: docente.siape, ...dados },
      update: dados,
    });
  }

  async salvarLookup(lookup: DocenteLookupSalvo): Promise<void> {
    const dados = {
      nomeOriginal: lookup.nomeOriginal,
      siape: lookup.siape,
      resolvedAt: new Date(),
      staleAfter: lookup.staleAfter,
    };
    await this.prisma.docenteLookup.upsert({
      where: { nomeNormalizado: lookup.nomeNormalizado },
      create: { nomeNormalizado: lookup.nomeNormalizado, ...dados },
      update: dados,
    });
  }
}
```

- [ ] **Step 9: Wire it into the database module**

In `backend/src/db/database.module.ts`, import `PrismaDocenteRepository` and `DOCENTE_REPOSITORY`, add a provider mirroring the `HISTORICO_REPOSITORY` block:

```ts
    {
      provide: DOCENTE_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaDocenteRepository(prisma),
    },
```

and add `DOCENTE_REPOSITORY` to the `exports` array.

- [ ] **Step 10: Verify the whole backend still compiles and passes**

Run: `npm run build && npm test`
Expected: build clean, entire suite green.

- [ ] **Step 11: Commit**

```bash
git add backend/prisma backend/src/docentes backend/src/db
git commit -m "feat(backend): add global docente cache tables and repository"
```

---

### Task 9: `DocentesService`

The heart of the feature. Resolution order, candidate choice, concurrency, and — most importantly — the failure rules.

**Files:**
- Create: `backend/src/docentes/concorrencia.ts`
- Create: `backend/src/docentes/selos.ts`
- Create: `backend/src/docentes/docentes.service.ts`
- Test: `backend/src/docentes/concorrencia.spec.ts`
- Test: `backend/src/docentes/selos.spec.ts`
- Test: `backend/src/docentes/docentes.service.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces:
  ```ts
  export interface TurmaDocente { codigo: string; nome: string; docente: string }
  export interface DocenteSelos {
    contato: boolean; formacao: boolean; areasInteresse: boolean;
    lattes: boolean; orientacoes: boolean; semestresLecionando: number;
  }
  export interface DocenteResumo {
    nomeOriginal: string;
    componentes: { codigo: string; nome: string }[];
    perfil: null | {
      siape: string; nome: string;
      departamento: string | null; unidade: string | null;
      selos: DocenteSelos;
    };
  }
  export class DocentesService {
    constructor(
      repositorio: DocenteRepository,
      http: SigaaHttpClient,
      criarSessao: () => PublicSigaaSession,
    );
    async resumoDoSemestre(turmas: TurmaDocente[]): Promise<DocenteResumo[]>;
    async perfil(siape: string): Promise<DocenteSalvo | null>;
  }
  export function calcularSelos(docente: DocenteSalvo): DocenteSelos;  // from ./selos
  export function mapComLimite<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]>;  // from ./concorrencia
  ```

- [ ] **Step 1: Write the failing tests for the two helpers**

Create `backend/src/docentes/concorrencia.spec.ts`:

```ts
import { mapComLimite } from './concorrencia';

describe('mapComLimite', () => {
  it('keeps results in input order regardless of completion order', async () => {
    const resultado = await mapComLimite([30, 10, 20], 2, (ms) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)),
    );
    expect(resultado).toEqual([30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let emVoo = 0;
    let pico = 0;
    await mapComLimite(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((resolve) => setTimeout(resolve, 5));
      emVoo -= 1;
      return null;
    });
    expect(pico).toBeLessThanOrEqual(4);
  });
});
```

Create `backend/src/docentes/selos.spec.ts`:

```ts
import { calcularSelos } from './selos';
import type { DocenteSalvo } from './docente.repository';

function docente(overrides: Partial<DocenteSalvo> = {}): DocenteSalvo {
  return {
    siape: '1815041',
    nome: 'FULANO',
    departamento: null,
    unidade: null,
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: null,
    telefone: null,
    email: null,
    disciplinas: [],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0,
      mestradoConcluidas: 0,
      doutoradoAndamento: 0,
      doutoradoConcluidas: 0,
    },
    fetchedAt: new Date(),
    staleAfter: new Date(),
    ...overrides,
  };
}

describe('calcularSelos', () => {
  it('is all-false for the empty profile that is the common case', () => {
    expect(calcularSelos(docente())).toEqual({
      contato: false,
      formacao: false,
      areasInteresse: false,
      lattes: false,
      orientacoes: false,
      semestresLecionando: 0,
    });
  });

  it('lights contato when any one contact field is present', () => {
    expect(calcularSelos(docente({ sala: 'IC-2012' })).contato).toBe(true);
    expect(calcularSelos(docente({ email: 'x@ufba.br' })).contato).toBe(true);
  });

  it('lights orientacoes for a supervised TCC alone, with all counts at zero', () => {
    expect(
      calcularSelos(docente({ tccsOrientados: [{ titulo: 'X', ano: 2024 }] })).orientacoes,
    ).toBe(true);
  });

  it('counts distinct terms, not course rows', () => {
    const disciplinas = [
      { semestre: '2026.2', codigo: 'MATA65', nome: 'CG', cargaHoraria: 60, horario: '' },
      { semestre: '2026.2', codigo: 'MATA62', nome: 'IA', cargaHoraria: 60, horario: '' },
      { semestre: '2026.1', codigo: 'MATA65', nome: 'CG', cargaHoraria: 60, horario: '' },
    ];
    expect(calcularSelos(docente({ disciplinas })).semestresLecionando).toBe(2);
  });
});
```

- [ ] **Step 2: Run both and watch them fail**

Run: `npm test -- src/docentes/concorrencia.spec.ts src/docentes/selos.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both helpers**

Create `backend/src/docentes/concorrencia.ts`:

```ts
/**
 * Promise.all with a ceiling. The docente profile GETs are stateless and would
 * happily all fire at once, but nobody has measured SIGAA's rate limit on these
 * public endpoints, so the ceiling is the cheap insurance.
 */
export async function mapComLimite<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;

  async function worker(): Promise<void> {
    while (proximo < itens.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await fn(itens[indice]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, () => worker()),
  );
  return resultados;
}
```

Create `backend/src/docentes/selos.ts`:

```ts
import type { DocenteSalvo } from './docente.repository';

/**
 * What the list card advertises is inside the detail screen. Computed here,
 * server-side, from what was actually persisted — the client must never have to
 * infer "is this worth a tap" from which fields came back null.
 */
export interface DocenteSelos {
  contato: boolean;
  formacao: boolean;
  areasInteresse: boolean;
  lattes: boolean;
  orientacoes: boolean;
  semestresLecionando: number;
}

export function calcularSelos(docente: DocenteSalvo): DocenteSelos {
  const { orientacoes } = docente;
  return {
    contato: Boolean(
      docente.enderecoProfissional || docente.sala || docente.telefone || docente.email,
    ),
    formacao: docente.formacao.length > 0,
    areasInteresse: docente.areasInteresse.length > 0,
    lattes: Boolean(docente.lattesUrl),
    orientacoes:
      docente.tccsOrientados.length > 0 ||
      orientacoes.mestradoAndamento > 0 ||
      orientacoes.mestradoConcluidas > 0 ||
      orientacoes.doutoradoAndamento > 0 ||
      orientacoes.doutoradoConcluidas > 0,
    semestresLecionando: new Set(docente.disciplinas.map((d) => d.semestre)).size,
  };
}
```

- [ ] **Step 4: Run both and watch them pass**

Run: `npm test -- src/docentes/concorrencia.spec.ts src/docentes/selos.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing service test**

Create `backend/src/docentes/docentes.service.spec.ts`:

```ts
import { DocentesService } from './docentes.service';
import type {
  DocenteLookupSalvo,
  DocenteRepository,
  DocenteSalvo,
} from './docente.repository';
import { PublicSigaaSession } from '../sigaa-engine/public-session';
import type { SigaaHttpClient, SigaaHttpResponse } from '../sigaa-engine/session';

const DIA = 24 * 60 * 60 * 1000;
const FRESCO = new Date(Date.now() + 20 * DIA);
const VENCIDO = new Date(Date.now() - DIA);

class RepositorioFake implements DocenteRepository {
  lookups: DocenteLookupSalvo[] = [];
  docentes: DocenteSalvo[] = [];
  lookupsSalvos: DocenteLookupSalvo[] = [];
  docentesSalvos: DocenteSalvo[] = [];

  buscarLookups(nomes: string[]): Promise<DocenteLookupSalvo[]> {
    return Promise.resolve(this.lookups.filter((l) => nomes.includes(l.nomeNormalizado)));
  }
  buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]> {
    return Promise.resolve(this.docentes.filter((d) => siapes.includes(d.siape)));
  }
  salvarDocente(docente: DocenteSalvo): Promise<void> {
    this.docentesSalvos.push(docente);
    return Promise.resolve();
  }
  salvarLookup(lookup: DocenteLookupSalvo): Promise<void> {
    this.lookupsSalvos.push(lookup);
    return Promise.resolve();
  }
}

function docenteSalvo(overrides: Partial<DocenteSalvo> = {}): DocenteSalvo {
  return {
    siape: '1815041',
    nome: 'ANTONIO LOPES APOLINARIO JUNIOR',
    departamento: 'DCC',
    unidade: 'IC',
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: 'IC- 2012',
    telefone: null,
    email: 'x@ufba.br',
    disciplinas: [],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0,
      mestradoConcluidas: 0,
      doutoradoAndamento: 0,
      doutoradoConcluidas: 0,
    },
    fetchedAt: new Date(),
    staleAfter: FRESCO,
    ...overrides,
  };
}

const PAGINA_BUSCA = `<input name="javax.faces.ViewState" value="j_id1" />`;

function resultadoBusca(siape: string, nome: string): string {
  return `<table class="listagem"><tr>
    <td><span class="nome">${nome}</span>
        <span class="departamento">DCC</span>
        <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=${siape}">ver</a></span>
    </td></tr></table>
    <input name="javax.faces.ViewState" value="j_id2" />`;
}

/** Answers by path/method so a test does not have to count requests. */
function httpRoteado(
  rotas: (req: { method: string; path: string }) => SigaaHttpResponse | Error,
): SigaaHttpClient {
  return {
    request(req) {
      const resposta = rotas(req);
      if (resposta instanceof Error) return Promise.reject(resposta);
      return Promise.resolve(resposta);
    },
  };
}

function ok(body: string): SigaaHttpResponse {
  return { status: 200, headers: { 'set-cookie': 'JSESSIONID=x' }, body };
}

describe('DocentesService.resumoDoSemestre', () => {
  it('serves a fresh cached docente without touching SIGAA at all', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'ANTONIO LOPES APOLINARIO JUNIOR',
        nomeOriginal: 'ANTONIO LOPES APOLINARIO JUNIOR',
        siape: '1815041',
        staleAfter: FRESCO,
      },
    ];
    repo.docentes = [docenteSalvo()];

    const http = httpRoteado(() => new Error('SIGAA must not be called'));
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'COMPUTAÇÃO GRÁFICA', docente: 'ANTONIO LOPES APOLINARIO JUNIOR' },
    ]);

    expect(resumo.perfil?.siape).toBe('1815041');
    expect(resumo.componentes).toEqual([{ codigo: 'MATA65', nome: 'COMPUTAÇÃO GRÁFICA' }]);
    expect(resumo.perfil?.selos.contato).toBe(true);
  });

  it('serves a fresh recorded miss as perfil null, without searching again', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'LARISSA BARBOSA LEONCIO PINHEIRO',
        nomeOriginal: 'LARISSA BARBOSA LEONCIO PINHEIRO',
        siape: null,
        staleAfter: FRESCO,
      },
    ];
    const http = httpRoteado(() => new Error('SIGAA must not be called'));
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA58', nome: 'X', docente: 'LARISSA BARBOSA LEONCIO PINHEIRO' },
    ]);
    expect(resumo.perfil).toBeNull();
  });

  it('resolves an unknown name end to end and persists both rows', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes')) return ok(PAGINA_BUSCA);
      if (req.method === 'POST') return ok(resultadoBusca('1815041', 'ANTONIO LOPES APOLINARIO JUNIOR'));
      if (req.path.includes('portal.jsf')) {
        return ok('<div id="contato"><dl><dt>Sala</dt><dd>IC- 2012</dd></dl></div>');
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'Antonio Lopes Apolinario Junior' },
    ]);

    expect(resumo.perfil?.siape).toBe('1815041');
    expect(repo.docentesSalvos).toHaveLength(1);
    expect(repo.lookupsSalvos[0]).toMatchObject({
      nomeNormalizado: 'ANTONIO LOPES APOLINARIO JUNIOR',
      siape: '1815041',
    });
  });

  it('records a miss when the search genuinely returns nothing', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) =>
      req.method === 'GET' ? ok(PAGINA_BUSCA) : ok('<input name="javax.faces.ViewState" value="j_id2" />'),
    );
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA58', nome: 'X', docente: 'LARISSA BARBOSA LEONCIO PINHEIRO' },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos[0]).toMatchObject({ siape: null });
  });

  // The rule that matters most: thirty seconds of downtime must not freeze a
  // "does not exist" for thirty days.
  it('does NOT record a miss when the search fails with a network error', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) =>
      req.method === 'GET' ? ok(PAGINA_BUSCA) : new Error('ECONNRESET'),
    );
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'FULANO DE TAL' },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  it('does NOT record a miss when SIGAA rejects the query with an error message', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) =>
      req.method === 'GET'
        ? ok(PAGINA_BUSCA)
        : ok('<ul class="erros"><li>É necessário informar pelo menos 4 caracteres</li></ul>'),
    );
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'ABC' },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  it('keeps resolving the other docentes when one of them fails', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes')) return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return req.body?.['form:nome'] === 'QUEBRADO'
          ? new Error('ECONNRESET')
          : ok(resultadoBusca('1815041', 'FUNCIONA'));
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'QUEBRADO' },
      { codigo: 'B1', nome: 'B', docente: 'FUNCIONA' },
    ]);

    expect(resumos.find((r) => r.nomeOriginal === 'QUEBRADO')?.perfil).toBeNull();
    expect(resumos.find((r) => r.nomeOriginal === 'FUNCIONA')?.perfil).not.toBeNull();
  });

  it('groups every course a docente teaches you under one entry', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      { nomeNormalizado: 'X Y', nomeOriginal: 'X Y', siape: '2530359', staleAfter: FRESCO },
    ];
    repo.docentes = [docenteSalvo({ siape: '2530359' })];
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const resumos = await service.resumoDoSemestre([
      { codigo: 'ENGG54', nome: 'A', docente: 'X Y' },
      { codigo: 'ENGG67', nome: 'B', docente: 'X Y' },
    ]);

    expect(resumos).toHaveLength(1);
    expect(resumos[0].componentes.map((c) => c.codigo)).toEqual(['ENGG54', 'ENGG67']);
  });

  it('prefers the exact normalised match over a longer name the substring search dragged in', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes')) return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">ALINE SILVA DE MOURA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">ALINE SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'ALINE SILVA' },
    ]);
    expect(resumo.perfil?.siape).toBe('222');
  });

  // A stale row is a month-old copy of a page that changes once a term. Serving
  // it now and resyncing afterwards is what keeps a slow or dead SIGAA from
  // turning into a hung screen.
  it('serves a stale row without waiting on SIGAA', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      { nomeNormalizado: 'X Y', nomeOriginal: 'X Y', siape: '1815041', staleAfter: VENCIDO },
    ];
    repo.docentes = [docenteSalvo({ staleAfter: VENCIDO, sala: 'SALA ANTIGA' })];

    // Never settles: if the response were awaited, this test would time out.
    const http = httpRoteado(() => ok(PAGINA_BUSCA));
    jest.spyOn(http, 'request').mockReturnValue(new Promise(() => {}));

    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));
    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'X Y' },
    ]);

    expect(resumos[0].perfil?.siape).toBe('1815041');
    expect(resumos[0].perfil?.selos.contato).toBe(true);
  });

  // Homonyms have not appeared in the wild yet, but attaching the wrong
  // stranger's profile to a real course is the one failure worse than showing
  // none, so the tie is broken on evidence or not at all.
  it('breaks a homonym tie using the course the student is enrolled in', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes')) return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      if (req.path.includes('disciplinas.jsf?siape=222')) {
        return ok(`<table class="listagem">
          <tr><td class="anoPeriodo" colspan="5">2026.2</td></tr>
          <tr><td class="codigo">MATA65</td><td>CG</td><td class="ch">60h</td><td class="horario">24T34</td></tr>
        </table>`);
      }
      if (req.path.includes('disciplinas.jsf?siape=111')) {
        return ok('<table class="listagem"></table>');
      }
      return ok('<div id="contato"><dl><dt>Sala</dt><dd>IC- 1</dd></dl></div>');
    });
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'JOAO SILVA' },
    ]);
    expect(resumo.perfil?.siape).toBe('222');
  });

  it('refuses to guess when the tie cannot be broken', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes')) return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      return ok('<table class="listagem"></table>');
    });
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'JOAO SILVA' },
    ]);
    expect(resumo.perfil).toBeNull();
    // Undecidable is not the same as absent, so no miss is recorded.
    expect(repo.lookupsSalvos).toHaveLength(0);
  });
});

describe('DocentesService.perfil', () => {
  it('reads straight from the repository', async () => {
    const repo = new RepositorioFake();
    repo.docentes = [docenteSalvo()];
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    expect((await service.perfil('1815041'))?.siape).toBe('1815041');
  });

  it('returns null for an unknown siape', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(repo, http, () => new PublicSigaaSession(http));

    expect(await service.perfil('999')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- src/docentes/docentes.service.spec.ts`
Expected: FAIL — cannot find module `./docentes.service`.

Note: the fake HTTP client's route function receives the whole `SigaaHttpRequest`, so `req.body` is available; if TypeScript complains about the narrowed parameter type in `httpRoteado`, widen it to `SigaaHttpRequest`.

- [ ] **Step 7: Implement the service**

Create `backend/src/docentes/docentes.service.ts`:

```ts
import { Logger } from '@nestjs/common';
import { normalizarNomeDocente } from '../sigaa-engine/docente-nome';
import { parseDocenteBusca } from '../sigaa-engine/parsers/docente-busca';
import { parseDocenteDisciplinas } from '../sigaa-engine/parsers/docente-disciplinas';
import { parseDocentePortal } from '../sigaa-engine/parsers/docente-portal';
import { parseDocenteProducao } from '../sigaa-engine/parsers/docente-producao';
import {
  getPaginaPublica,
  PublicSigaaSession,
} from '../sigaa-engine/public-session';
import type { SigaaHttpClient } from '../sigaa-engine/session';
import type { DocenteRepository, DocenteSalvo } from './docente.repository';
import { mapComLimite } from './concorrencia';
import { calcularSelos, type DocenteSelos } from './selos';
import { calcularStaleAfter } from './stale';

const LIMITE_GETS = 4;

export interface TurmaDocente {
  codigo: string;
  nome: string;
  docente: string;
}

export interface DocenteResumo {
  nomeOriginal: string;
  componentes: { codigo: string; nome: string }[];
  perfil: null | {
    siape: string;
    nome: string;
    departamento: string | null;
    unidade: string | null;
    selos: DocenteSelos;
  };
}

interface Pendente {
  nomeOriginal: string;
  nomeNormalizado: string;
  codigos: string[];
}

export class DocentesService {
  private readonly logger = new Logger(DocentesService.name);

  constructor(
    private readonly repositorio: DocenteRepository,
    private readonly http: SigaaHttpClient,
    private readonly criarSessao: () => PublicSigaaSession,
  ) {}

  async resumoDoSemestre(turmas: TurmaDocente[]): Promise<DocenteResumo[]> {
    // One entry per distinct docente, carrying every course they teach you.
    const porNome = new Map<string, { nomeOriginal: string; componentes: { codigo: string; nome: string }[] }>();
    for (const turma of turmas) {
      const chave = normalizarNomeDocente(turma.docente);
      const entrada = porNome.get(chave) ?? { nomeOriginal: turma.docente, componentes: [] };
      entrada.componentes.push({ codigo: turma.codigo, nome: turma.nome });
      porNome.set(chave, entrada);
    }

    const agora = new Date();
    const lookups = await this.repositorio.buscarLookups([...porNome.keys()]);
    const porNomeNormalizado = new Map(lookups.map((l) => [l.nomeNormalizado, l]));

    // A stale row is served, not awaited: a month-old profile is the same data
    // from a page that changes once a term, and waiting on a slow SIGAA would
    // turn "slightly old" into "screen hangs".
    const siapesFrescos = lookups
      .filter((l) => l.siape !== null && l.staleAfter > agora)
      .map((l) => l.siape as string);
    const siapesVencidos = lookups
      .filter((l) => l.siape !== null && l.staleAfter <= agora)
      .map((l) => l.siape as string);

    const cacheados = await this.repositorio.buscarDocentes([
      ...siapesFrescos,
      ...siapesVencidos,
    ]);
    const porSiape = new Map(cacheados.map((d) => [d.siape, d]));

    const pendentes: Pendente[] = [];
    const resumos: DocenteResumo[] = [];

    for (const [nomeNormalizado, entrada] of porNome) {
      const lookup = porNomeNormalizado.get(nomeNormalizado);
      const docente = lookup?.siape ? porSiape.get(lookup.siape) : undefined;

      if (lookup && lookup.staleAfter > agora && !lookup.siape) {
        resumos.push({ ...entrada, perfil: null });
        continue;
      }
      if (docente && docente.staleAfter > agora) {
        resumos.push({ ...entrada, perfil: this.paraPerfil(docente) });
        continue;
      }
      if (docente) {
        // Stale: serve it now, resync outside the request.
        resumos.push({ ...entrada, perfil: this.paraPerfil(docente) });
        void this.revalidar(nomeNormalizado, entrada.nomeOriginal, entrada.componentes);
        continue;
      }
      pendentes.push({
        nomeOriginal: entrada.nomeOriginal,
        nomeNormalizado,
        codigos: entrada.componentes.map((c) => c.codigo),
      });
    }

    if (pendentes.length > 0) {
      const resolvidos = await this.resolver(pendentes);
      for (const pendente of pendentes) {
        const entrada = porNome.get(pendente.nomeNormalizado)!;
        const docente = resolvidos.get(pendente.nomeNormalizado);
        resumos.push({
          nomeOriginal: entrada.nomeOriginal,
          componentes: entrada.componentes,
          perfil: docente ? this.paraPerfil(docente) : null,
        });
      }
    }

    return resumos;
  }

  async perfil(siape: string): Promise<DocenteSalvo | null> {
    const [docente] = await this.repositorio.buscarDocentes([siape]);
    if (!docente) {
      return null;
    }
    if (docente.staleAfter <= new Date()) {
      void this.recarregar(docente.siape).catch((error: unknown) => {
        this.logger.warn(`Background resync of docente ${siape} failed`, error);
      });
    }
    return docente;
  }

  private paraPerfil(docente: DocenteSalvo): DocenteResumo['perfil'] {
    return {
      siape: docente.siape,
      nome: docente.nome,
      departamento: docente.departamento,
      unidade: docente.unidade,
      selos: calcularSelos(docente),
    };
  }

  /** Search POSTs are serial: the ViewState chains and cannot be parallelised. */
  private async resolver(pendentes: Pendente[]): Promise<Map<string, DocenteSalvo>> {
    const resolvidos = new Map<string, DocenteSalvo>();
    const sessao = this.criarSessao();
    await sessao.iniciar();

    const siapes: { pendente: Pendente; siape: string }[] = [];

    for (const pendente of pendentes) {
      try {
        const html = await sessao.buscar(pendente.nomeNormalizado);
        const resposta = parseDocenteBusca(html);

        if (resposta.tipo === 'erro') {
          // SIGAA rejected the query. Not evidence the docente is absent, so no
          // miss is recorded.
          this.logger.warn(`SIGAA rejected the search for ${pendente.nomeOriginal}: ${resposta.mensagem}`);
          continue;
        }

        if (resposta.docentes.length === 0) {
          // A genuine zero-result: this docente has no public record. Recorded
          // so the name is not re-searched on every screen open.
          await this.repositorio.salvarLookup({
            nomeNormalizado: pendente.nomeNormalizado,
            nomeOriginal: pendente.nomeOriginal,
            siape: null,
            staleAfter: calcularStaleAfter(new Date()),
          });
          continue;
        }

        const escolhido = await this.escolherCandidato(resposta.docentes, pendente);
        if (!escolhido) {
          // Candidates exist but none can be singled out. Undecidable is not
          // the same as absent, so this is NOT recorded as a miss — the next
          // open tries again, perhaps with more courses to disambiguate on.
          this.logger.warn(`Could not disambiguate ${pendente.nomeOriginal}`);
          continue;
        }
        siapes.push({ pendente, siape: escolhido });
      } catch (error) {
        // Network error, 429, unexpected status: never a miss.
        this.logger.warn(`Failed to search for ${pendente.nomeOriginal}`, error);
      }
    }

    // Profile pages are stateless, so these can overlap — capped, since nobody
    // has measured the rate limit on the public endpoints.
    const perfis = await mapComLimite(siapes, LIMITE_GETS, async ({ pendente, siape }) => {
      try {
        const docente = await this.carregarPerfil(siape);
        if (!docente) {
          return null;
        }
        await this.repositorio.salvarDocente(docente);
        await this.repositorio.salvarLookup({
          nomeNormalizado: pendente.nomeNormalizado,
          nomeOriginal: pendente.nomeOriginal,
          siape,
          staleAfter: calcularStaleAfter(new Date()),
        });
        return { nomeNormalizado: pendente.nomeNormalizado, docente };
      } catch (error) {
        this.logger.warn(`Failed to load the profile of siape ${siape}`, error);
        return null;
      }
    });

    for (const entrada of perfis) {
      if (entrada) {
        resolvidos.set(entrada.nomeNormalizado, entrada.docente);
      }
    }
    return resolvidos;
  }

  /**
   * Exact normalised equality first. The search is a contiguous-substring match,
   * so a name that is a prefix of another returns both (measured: 1 case in
   * 339).
   */
  private async escolherCandidato(
    candidatos: { siape: string; nome: string }[],
    pendente: Pendente,
  ): Promise<string | null> {
    if (candidatos.length === 0) {
      return null;
    }
    const exatos = candidatos.filter(
      (c) => normalizarNomeDocente(c.nome) === pendente.nomeNormalizado,
    );
    if (exatos.length === 1) {
      return exatos[0].siape;
    }
    if (exatos.length === 0) {
      return candidatos[0].siape;
    }

    // Homonyms: break the tie on evidence, not on row order. The right siape is
    // the one whose courses-taught page lists a course the student is actually
    // enrolled in. Never observed yet (339 distinct docentes in the sample, no
    // name repeated across siapes), but guessing here would staple a stranger's
    // profile onto a real course, so if the evidence does not single one out we
    // return null and the card renders as "no profile".
    const vencedores = (
      await mapComLimite(exatos, LIMITE_GETS, async (candidato) => {
        const html = await getPaginaPublica(
          this.http,
          `/sigaa/public/docente/disciplinas.jsf?siape=${candidato.siape}`,
        ).catch(() => null);
        if (!html) {
          return null;
        }
        const ensina = parseDocenteDisciplinas(html).some((d) =>
          pendente.codigos.includes(d.codigo),
        );
        return ensina ? candidato.siape : null;
      })
    ).filter((siape): siape is string => siape !== null);

    return vencedores.length === 1 ? vencedores[0] : null;
  }

  private async carregarPerfil(siape: string): Promise<DocenteSalvo | null> {
    const [portalHtml, disciplinasHtml, producaoHtml] = await Promise.all([
      getPaginaPublica(this.http, `/sigaa/public/docente/portal.jsf?siape=${siape}`),
      getPaginaPublica(this.http, `/sigaa/public/docente/disciplinas.jsf?siape=${siape}`),
      getPaginaPublica(this.http, `/sigaa/public/docente/producao.jsf?siape=${siape}`),
    ]);

    if (!portalHtml) {
      return null;
    }

    const portal = parseDocentePortal(portalHtml);
    const producao = producaoHtml
      ? parseDocenteProducao(producaoHtml)
      : {
          tccsOrientados: [],
          orientacoes: {
            mestradoAndamento: 0,
            mestradoConcluidas: 0,
            doutoradoAndamento: 0,
            doutoradoConcluidas: 0,
          },
        };
    const agora = new Date();

    return {
      siape,
      nome: portal.nome ?? '',
      departamento: portal.departamento,
      unidade: portal.unidade,
      descricaoPessoal: portal.descricaoPessoal,
      formacao: portal.formacao,
      areasInteresse: portal.areasInteresse,
      lattesUrl: portal.lattesUrl,
      enderecoProfissional: portal.enderecoProfissional,
      sala: portal.sala,
      telefone: portal.telefone,
      email: portal.email,
      disciplinas: disciplinasHtml ? parseDocenteDisciplinas(disciplinasHtml) : [],
      tccsOrientados: producao.tccsOrientados,
      orientacoes: producao.orientacoes,
      fetchedAt: agora,
      staleAfter: calcularStaleAfter(agora),
    };
  }

  private async recarregar(siape: string): Promise<void> {
    const docente = await this.carregarPerfil(siape);
    if (docente) {
      await this.repositorio.salvarDocente(docente);
    }
  }

  private async revalidar(
    nomeNormalizado: string,
    nomeOriginal: string,
    componentes: { codigo: string; nome: string }[],
  ): Promise<void> {
    try {
      await this.resolver([
        { nomeOriginal, nomeNormalizado, codigos: componentes.map((c) => c.codigo) },
      ]);
    } catch (error) {
      // A failed resync is retried on the next access; it must never surface.
      this.logger.warn(`Background revalidation of ${nomeOriginal} failed`, error);
    }
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npm test -- src/docentes/docentes.service.spec.ts`
Expected: PASS, 14 tests.

The nome the resolved docente carries comes from `parseDocentePortal`. If the portal selector for the name is unreliable (see Task 4 step 4), fall back to the name from the search result: pass the candidate's `nome` into `carregarPerfil` and use it when `portal.nome` is null. Add a test asserting the resolved `perfil.nome` is non-empty.

- [ ] **Step 9: Commit**

```bash
git add backend/src/docentes
git commit -m "feat(backend): resolve docente profiles on demand with a global cache"
```

---

### Task 10: Controller and module wiring

**Files:**
- Create: `backend/src/docentes/docentes.controller.ts`
- Create: `backend/src/docentes/semestre.dto.ts`
- Create: `backend/src/docentes/docentes.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/docentes/docentes.controller.spec.ts`

**Interfaces:**
- Consumes: `DocentesService` (Task 9), `DOCENTE_REPOSITORY` (Task 8), `JwtAuthGuard` from `../auth/jwt-auth.guard`, `createSigaaHttpClient` from `../sigaa-engine/http-client`.
- Produces: `POST /docentes/semestre` and `GET /docentes/:siape`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/docentes/docentes.controller.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { DocentesController } from './docentes.controller';
import type { DocentesService } from './docentes.service';

function servicoFake(overrides: Partial<DocentesService> = {}): DocentesService {
  return {
    resumoDoSemestre: jest.fn().mockResolvedValue([]),
    perfil: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DocentesService;
}

describe('DocentesController', () => {
  it('passes only turmas that name a docente through to the service', async () => {
    const resumoDoSemestre = jest.fn().mockResolvedValue([]);
    const controller = new DocentesController(servicoFake({ resumoDoSemestre } as never));

    await controller.semestre({
      turmas: [
        { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
        { codigo: 'MATA59', nome: 'X', docente: '' },
      ],
    });

    expect(resumoDoSemestre).toHaveBeenCalledWith([
      { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
    ]);
  });

  it('404s on an unknown siape instead of returning an empty profile', async () => {
    const controller = new DocentesController(servicoFake());
    await expect(controller.detalhe('999')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the profile for a known siape', async () => {
    const perfil = jest.fn().mockResolvedValue({ siape: '1815041', nome: 'FULANO' });
    const controller = new DocentesController(servicoFake({ perfil } as never));
    await expect(controller.detalhe('1815041')).resolves.toMatchObject({ siape: '1815041' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/docentes/docentes.controller.spec.ts`
Expected: FAIL — cannot find module `./docentes.controller`.

- [ ] **Step 3: Implement the DTO and controller**

Create `backend/src/docentes/semestre.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class TurmaDocenteDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsString()
  docente!: string;
}

export class SemestreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TurmaDocenteDto)
  turmas!: TurmaDocenteDto[];
}
```

Create `backend/src/docentes/docentes.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { DocenteSalvo } from './docente.repository';
import { DocentesService, type DocenteResumo } from './docentes.service';
import { SemestreDto } from './semestre.dto';

@Controller('docentes')
@UseGuards(JwtAuthGuard)
export class DocentesController {
  constructor(private readonly service: DocentesService) {}

  /**
   * POST, not GET, for the same reason /schedule is: the client sends a list in
   * the body, and a spec-compliant fetch cannot put a body on a GET.
   *
   * No user scoping: the response is public data, identical for every student.
   */
  @Post('semestre')
  async semestre(@Body() dto: SemestreDto): Promise<DocenteResumo[]> {
    // A turma with no docente on the atestado is its own empty state and the
    // client renders it locally — nothing to resolve here.
    const turmas = dto.turmas.filter((t) => t.docente.trim().length > 0);
    return this.service.resumoDoSemestre(turmas);
  }

  @Get(':siape')
  async detalhe(@Param('siape') siape: string): Promise<DocenteSalvo> {
    const docente = await this.service.perfil(siape);
    if (!docente) {
      throw new NotFoundException(`No cached profile for siape ${siape}`);
    }
    return docente;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/docentes/docentes.controller.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the module**

Create `backend/src/docentes/docentes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { DOCENTE_REPOSITORY } from '../db/tokens';
import { createSigaaHttpClient } from '../sigaa-engine/http-client';
import { PublicSigaaSession } from '../sigaa-engine/public-session';
import type { DocenteRepository } from './docente.repository';
import { DocentesController } from './docentes.controller';
import { DocentesService } from './docentes.service';

/**
 * Deliberately not part of SigaaEngineModule: that module is "things that need
 * the student's SIGAA credentials". A docente profile is the opposite — public,
 * global, and tied to no user.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DocentesController],
  providers: [
    {
      provide: DocentesService,
      inject: [DOCENTE_REPOSITORY],
      useFactory: (repositorio: DocenteRepository) => {
        const http = createSigaaHttpClient();
        return new DocentesService(repositorio, http, () => new PublicSigaaSession(http));
      },
    },
  ],
})
export class DocentesModule {}
```

Add `DocentesModule` to the `imports` array in `backend/src/app.module.ts`.

- [ ] **Step 6: Verify the whole backend**

Run: `npm run build && npm test && npm run lint`
Expected: build clean, full suite green, lint clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/docentes backend/src/app.module.ts
git commit -m "feat(backend): expose the docentes endpoints"
```

---

### Task 11: Mobile types and API client

> **Plan amendment (ruled before execution).** An earlier draft of this task
> created `mobile/src/lib/turmas-cache.ts` and had the home screen write the
> term's turmas into it, because fetching the schedule used to cost a SIGAA
> login plus the atestado. That is no longer true: the backend now persists the
> schedule, and `getSchedule(accessToken)` is a plain cached read with no
> credentials involved. The Professores screen calls it directly. The local
> cache, its tests, and the home-screen edit are all dropped.

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Test: `mobile/src/lib/api.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: the backend endpoints from Task 10.
- Produces:
  ```ts
  // types.ts
  export interface DocenteSelos { contato: boolean; formacao: boolean; areasInteresse: boolean;
    lattes: boolean; orientacoes: boolean; semestresLecionando: number }
  export interface DocenteResumo { nomeOriginal: string;
    componentes: { codigo: string; nome: string }[];
    perfil: null | { siape: string; nome: string; departamento: string | null;
      unidade: string | null; selos: DocenteSelos } }
  export interface DocenteDisciplina { semestre: string; codigo: string; nome: string;
    cargaHoraria: number; horario: string }
  export interface DocentePerfil { siape: string; nome: string; departamento: string | null;
    unidade: string | null; descricaoPessoal: string | null; formacao: string[];
    areasInteresse: string[]; lattesUrl: string | null; enderecoProfissional: string | null;
    sala: string | null; telefone: string | null; email: string | null;
    disciplinas: DocenteDisciplina[]; tccsOrientados: { titulo: string; ano: number }[];
    orientacoes: { mestradoAndamento: number; mestradoConcluidas: number;
      doutoradoAndamento: number; doutoradoConcluidas: number } }
  // api.ts
  export async function postDocentesSemestre(accessToken: string,
    turmas: { codigo: string; nome: string; docente: string }[]): Promise<DocenteResumo[]>;
  export async function getDocente(accessToken: string, siape: string): Promise<DocentePerfil>;
  ```
  The Professores screen gets its turmas from the existing
  `getSchedule(accessToken): Promise<ScheduleResponse>`, whose type is the union
  `{ sincronizado: false } | { turmas: Turma[]; periodoLetivo: PeriodoLetivo | null; fetchedAt: string }`.
  `Turma.codigo` and `Turma.docente` are both `string | null`.

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/lib/api.test.ts`, following the existing file's shape
(it stubs `global.fetch` and asserts the exact URL, method, headers and body):

```ts
describe("postDocentesSemestre", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("posts the turmas and returns the parsed resumos", async () => {
    const resumos = [{ nomeOriginal: "FULANO", componentes: [], perfil: null }];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resumos,
    });

    const turmas = [{ codigo: "MATA65", nome: "CG", docente: "FULANO" }];
    await expect(postDocentesSemestre("token", turmas)).resolves.toEqual(resumos);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/docentes/semestre",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({ turmas }),
      }),
    );
  });

  it("surfaces a failed response as an ApiError", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: "SIGAA fora do ar" }),
    });
    await expect(postDocentesSemestre("token", [])).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getDocente", () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it("gets the profile by siape", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ siape: "1815041" }),
    });

    await expect(getDocente("token", "1815041")).resolves.toMatchObject({
      siape: "1815041",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://192.168.1.10:3000/docentes/1815041",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
```

Add `getDocente` and `postDocentesSemestre` to the import list at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run from `mobile/`: `npm test -- src/lib/api.test.ts`
Expected: FAIL — `postDocentesSemestre` is not exported from `./api`.

- [ ] **Step 3: Add the types**

Append the `DocenteSelos`, `DocenteResumo`, `DocenteDisciplina` and `DocentePerfil`
interfaces from the **Interfaces** block above to `mobile/src/lib/types.ts`, each
with a one-line comment saying which backend shape it mirrors (the file's existing
convention — see the `ScheduleResponse` comment).

- [ ] **Step 4: Add the API functions**

Append to `mobile/src/lib/api.ts`, and add `DocentePerfil`/`DocenteResumo` to the
type import at the top:

```ts
// The first call for a set of docentes resolves them against SIGAA (one search
// POST each, serial, plus three profile GETs each) — far past the default
// timeout. Subsequent calls hit the backend's global cache and are instant.
const DOCENTES_TIMEOUT_MS = 60_000;

export async function postDocentesSemestre(
  accessToken: string,
  turmas: { codigo: string; nome: string; docente: string }[],
): Promise<DocenteResumo[]> {
  return request<DocenteResumo[]>("/docentes/semestre", {
    method: "POST",
    body: { turmas },
    accessToken,
    timeoutMs: DOCENTES_TIMEOUT_MS,
  });
}

export async function getDocente(
  accessToken: string,
  siape: string,
): Promise<DocentePerfil> {
  return request<DocentePerfil>(`/docentes/${siape}`, { method: "GET", accessToken });
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test -- src/lib/api.test.ts`
Expected: PASS, including the 3 new tests.

- [ ] **Step 6: Verify nothing regressed**

Run: `npm test && npm run typecheck && npm run lint`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/lib/api.ts mobile/src/lib/api.test.ts mobile/src/lib/types.ts
git commit -m "feat(mobile): add the docentes API client"
```


---

### Task 12: `DocenteCard`

**Files:**
- Create: `mobile/src/components/DocenteCard.tsx`
- Modify: `mobile/src/components/AppIcon.tsx`
- Test: `mobile/src/__tests__/docente-card.test.tsx`

**Interfaces:**
- Consumes: `DocenteResumo` (Task 11).
- Produces:
  ```tsx
  export function DocenteCard(props: {
    resumo: DocenteResumo;
    onPress: (siape: string) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `mobile/src/__tests__/docente-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { DocenteCard } from "@/components/DocenteCard";
import type { DocenteResumo } from "@/lib/types";

// heroui-native has to be mocked by hand in this codebase — see
// trajetoria.test.tsx. Note Typography is a compound component here:
// Typography.Heading / Typography.Paragraph, never a bare <Typography>.
jest.mock("heroui-native", () => {
  const { Text, View } = jest.requireActual("react-native");
  return {
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

function resumo(overrides: Partial<DocenteResumo> = {}): DocenteResumo {
  return {
    nomeOriginal: "ANTONIO LOPES APOLINARIO JUNIOR",
    componentes: [{ codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA" }],
    perfil: {
      siape: "1815041",
      nome: "ANTONIO LOPES APOLINARIO JUNIOR",
      departamento: "DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC",
      unidade: null,
      selos: {
        contato: true,
        formacao: true,
        areasInteresse: false,
        lattes: true,
        orientacoes: false,
        semestresLecionando: 8,
      },
    },
    ...overrides,
  };
}

describe("DocenteCard", () => {
  it("shows the name and the courses this docente teaches you", () => {
    render(<DocenteCard resumo={resumo()} onPress={jest.fn()} />);
    expect(screen.getByText("ANTONIO LOPES APOLINARIO JUNIOR")).toBeTruthy();
    expect(screen.getByText("MATA65")).toBeTruthy();
  });

  it("advertises what is inside so a tap is never wasted", () => {
    render(<DocenteCard resumo={resumo()} onPress={jest.fn()} />);
    expect(screen.getByText("Contato")).toBeTruthy();
    expect(screen.getByText("Formação")).toBeTruthy();
    expect(screen.getByText("Lattes")).toBeTruthy();
    expect(screen.queryByText("Áreas")).toBeNull();
    expect(screen.getByText("8 semestres")).toBeTruthy();
  });

  it("navigates with the siape when tapped", () => {
    const onPress = jest.fn();
    render(<DocenteCard resumo={resumo()} onPress={onPress} />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledWith("1815041");
  });

  // 1 of 5 docentes on the real atestado had no public record. This state is
  // first-class, not an error.
  it("is disabled and says why when there is no public profile", () => {
    const onPress = jest.fn();
    render(<DocenteCard resumo={resumo({ perfil: null })} onPress={onPress} />);
    expect(screen.getByText("Perfil não disponível no SIGAA")).toBeTruthy();
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("falls back to a singular label for a single term", () => {
    const base = resumo();
    render(
      <DocenteCard
        resumo={{ ...base, perfil: { ...base.perfil!, selos: { ...base.perfil!.selos, semestresLecionando: 1 } } }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText("1 semestre")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/__tests__/docente-card.test.tsx`
Expected: FAIL — cannot find module `@/components/DocenteCard`.

- [ ] **Step 3: Add the icon**

In `mobile/src/components/AppIcon.tsx`, add to `ICON_MAP`:

```ts
  IconChalkboardTeacher: "easel-outline",
```

(Ionicons has no chalkboard glyph; `easel-outline` is the closest, and `school-outline` is already taken by `IconGraduationCap`.)

- [ ] **Step 4: Implement the card**

Create `mobile/src/components/DocenteCard.tsx`:

```tsx
import { Chip, Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import type { DocenteResumo, DocenteSelos } from "@/lib/types";

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

/**
 * What the badges are for: in the measured sample most public profiles are
 * nearly empty, so a card that looks tappable but leads to a blank page is the
 * failure mode to design out. The badges say what is actually behind the tap,
 * and a docente with no public record at all does not navigate.
 */
function rotulosDosSelos(selos: DocenteSelos): string[] {
  const rotulos: string[] = [];
  if (selos.contato) rotulos.push("Contato");
  if (selos.formacao) rotulos.push("Formação");
  if (selos.areasInteresse) rotulos.push("Áreas");
  if (selos.lattes) rotulos.push("Lattes");
  if (selos.orientacoes) rotulos.push("Orientações");
  if (selos.semestresLecionando > 0) {
    rotulos.push(
      selos.semestresLecionando === 1 ? "1 semestre" : `${selos.semestresLecionando} semestres`,
    );
  }
  return rotulos;
}

export function DocenteCard({
  resumo,
  onPress,
}: {
  resumo: DocenteResumo;
  onPress: (siape: string) => void;
}): JSX.Element {
  const mutedColor = useThemeColor("muted");
  const perfil = resumo.perfil;
  const desabilitado = perfil === null;
  const nome = perfil?.nome ?? resumo.nomeOriginal;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: desabilitado }}
      disabled={desabilitado}
      onPress={() => {
        if (perfil) onPress(perfil.siape);
      }}
      style={{ opacity: desabilitado ? 0.55 : 1 }}
      className="mb-3 rounded-2xl border border-border p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-muted/20">
          <Typography.Paragraph type="body-sm">{iniciais(nome)}</Typography.Paragraph>
        </View>
        <View className="flex-1">
          <Typography.Paragraph type="body-sm" numberOfLines={2}>
            {nome}
          </Typography.Paragraph>
          {perfil?.departamento ? (
            <Typography.Paragraph type="body-xs" color="muted" numberOfLines={1}>
              {perfil.departamento}
            </Typography.Paragraph>
          ) : null}
        </View>
        {desabilitado ? null : (
          <AppIcon name="IconCaretRight" size={18} color={mutedColor} />
        )}
      </View>

      <View className="mt-3 flex-row flex-wrap gap-1.5">
        {resumo.componentes.map((componente) => (
          <Chip key={componente.codigo} variant="soft" size="sm">
            {componente.codigo}
          </Chip>
        ))}
      </View>

      {desabilitado ? (
        <Typography.Paragraph type="body-xs" color="muted" className="mt-3">
          Perfil não disponível no SIGAA
        </Typography.Paragraph>
      ) : (
        <View className="mt-3 flex-row flex-wrap gap-x-3 gap-y-1">
          {rotulosDosSelos(perfil.selos).map((rotulo) => (
            <Typography.Paragraph key={rotulo} type="body-xs" color="muted">
              {rotulo}
            </Typography.Paragraph>
          ))}
        </View>
      )}
    </Pressable>
  );
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test -- src/__tests__/docente-card.test.tsx`
Expected: PASS, 5 tests.

Do not add a new dependency to make this pass. If a HeroUI Native prop is rejected, check how `src/app/(tabs)/documentos.tsx` (Chip) and `src/app/(tabs)/trajetoria.tsx` (Typography, Button) actually call it and match that.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/DocenteCard.tsx mobile/src/components/AppIcon.tsx mobile/src/__tests__/docente-card.test.tsx
git commit -m "feat(mobile): add the docente card with what's-inside badges"
```

---

### Task 13: The Professores list screen and tab

**Files:**
- Create: `mobile/src/app/(tabs)/professores.tsx`
- Modify: `mobile/src/app/(tabs)/_layout.tsx`
- Test: `mobile/src/__tests__/professores.test.tsx`

**Interfaces:**
- Consumes: `DocenteCard` (Task 12), `postDocentesSemestre` (Task 11), the existing `getSchedule` from `@/lib/api`, `useAuth` from `@/lib/auth-context`, `describeApiError` from `@/lib/api-errors`.
- Produces: the `/professores` route.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/__tests__/professores.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react-native";

import ProfessoresScreen from "@/app/(tabs)/professores";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocenteResumo, Turma } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getSchedule: jest.fn(),
  postDocentesSemestre: jest.fn(),
}));

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

// The global header pulls in Avatar, auth and routing of its own; this screen's
// tests are about the list, not the chrome.
jest.mock("@/components/AppBar", () => ({ AppBar: () => null }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

const mostrarToast = jest.fn();

// Hand-mocked, as every screen test in this codebase does. Typography is
// compound here — Typography.Heading / Typography.Paragraph.
jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
    useToast: () => ({ toast: { show: mostrarToast } }),
  };
});

const mockedPost = postDocentesSemestre as jest.MockedFunction<typeof postDocentesSemestre>;
const mockedSchedule = getSchedule as jest.MockedFunction<typeof getSchedule>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function resumo(nome: string, perfil: DocenteResumo["perfil"]): DocenteResumo {
  return { nomeOriginal: nome, componentes: [{ codigo: "MATA65", nome: "CG" }], perfil };
}

function turma(codigo: string, nome: string, docente: string | null): Turma {
  return {
    codigo,
    nome,
    docente,
    slots: [],
    vigencia: { inicio: "2026-08-19", fim: "2026-12-19" },
    semestre: "2026.2",
  };
}

describe("Professores screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // useAuth's real shape has more on it; the screen only reads accessToken.
    mockedAuth.mockReturnValue({ accessToken: "token" } as ReturnType<typeof useAuth>);
    mockedSchedule.mockResolvedValue({
      turmas: [
        turma("MATA65", "CG", "FULANO DE TAL"),
        turma("MATA59", "SEM DOCENTE", null),
      ],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
  });

  it("warns that the first load goes to SIGAA, so a long wait is not a hang", async () => {
    mockedPost.mockReturnValue(new Promise(() => {}));
    render(<ProfessoresScreen />);
    expect(await screen.findByText(/só na primeira vez/i)).toBeTruthy();
  });

  it("renders a card per docente once resolved", async () => {
    mockedPost.mockResolvedValue([
      resumo("FULANO DE TAL", {
        siape: "1815041",
        nome: "FULANO DE TAL",
        departamento: "DCC",
        unidade: null,
        selos: {
          contato: true, formacao: false, areasInteresse: false,
          lattes: false, orientacoes: false, semestresLecionando: 3,
        },
      }),
    ]);
    render(<ProfessoresScreen />);
    expect(await screen.findByText("FULANO DE TAL")).toBeTruthy();
  });

  // Three empty states that must not look alike.
  it("shows a turma whose atestado named no docente as its own muted row", async () => {
    mockedPost.mockResolvedValue([]);
    render(<ProfessoresScreen />);
    expect(await screen.findByText(/docente não informado/i)).toBeTruthy();
    expect(screen.getByText("MATA59")).toBeTruthy();
  });

  it("never sends a turma with no docente to the backend", async () => {
    mockedPost.mockResolvedValue([]);
    render(<ProfessoresScreen />);
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockedPost.mock.calls[0][1]).toEqual([
      { codigo: "MATA65", nome: "CG", docente: "FULANO DE TAL" },
    ]);
  });

  it("shows the full-screen empty state when there are no turmas at all", async () => {
    mockedSchedule.mockResolvedValue({
      turmas: [],
      periodoLetivo: null,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    });
    render(<ProfessoresScreen />);
    expect(await screen.findByText(/nenhuma matéria/i)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  // The backend's schedule is a cached read that can legitimately be empty
  // before the student has ever synced — a different state from "no turmas".
  it("points the user at Início when the schedule was never synced", async () => {
    mockedSchedule.mockResolvedValue({ sincronizado: false });
    render(<ProfessoresScreen />);
    expect(await screen.findByText(/sincronizar sua grade/i)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("offers a retry when the request fails", async () => {
    mockedPost.mockRejectedValue(new Error("boom"));
    render(<ProfessoresScreen />);
    expect(await screen.findByText(/tentar novamente/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/__tests__/professores.test.tsx`
Expected: FAIL — cannot find module `@/app/(tabs)/professores`.

- [ ] **Step 3: Implement the screen**

Create `mobile/src/app/(tabs)/professores.tsx`. Match the surrounding screens' structure — open `src/app/(tabs)/trajetoria.tsx` and follow how it composes `AppBar`, `ScrollView`, loading and error states.

```tsx
import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useToast } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { DocenteCard } from "@/components/DocenteCard";
import { getSchedule, postDocentesSemestre } from "@/lib/api";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import type { DocenteResumo } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; docentes: DocenteResumo[]; semDocente: { codigo: string; nome: string }[] }
  | { status: "empty" }
  | { status: "unsynced" }
  | { status: "error"; message: string };

export default function ProfessoresScreen(): JSX.Element {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  const carregar = useCallback(async () => {
    setEstado({ status: "loading" });

    try {
      // The backend persists the schedule, so this is a cached read: no
      // credentials, no SIGAA round trip, same source the home screen uses.
      const horario = await getSchedule(accessToken ?? "");
      if (!("turmas" in horario)) {
        setEstado({ status: "unsynced" });
        return;
      }
      if (horario.turmas.length === 0) {
        setEstado({ status: "empty" });
        return;
      }

      // A turma whose atestado named no docente is a different empty state from
      // a docente with no public profile — it never goes to the backend.
      const semDocente = horario.turmas
        .filter((t) => !t.docente)
        .map((t) => ({ codigo: t.codigo ?? t.nome, nome: t.nome }));
      const comDocente = horario.turmas
        .filter((t) => Boolean(t.docente))
        .map((t) => ({ codigo: t.codigo ?? "", nome: t.nome, docente: t.docente as string }));

      // Cold path: every docente is resolved against SIGAA one search at a time.
      // Warm path: the backend's cache is global, so this returns immediately.
      toast.show({
        label: "Buscando os perfis no SIGAA. Isso só acontece na primeira vez.",
      });

      const docentes = await postDocentesSemestre(accessToken ?? "", comDocente);
      setEstado({ status: "ready", docentes, semDocente });
    } catch (error) {
      setEstado({ status: "error", message: describeApiError(error) });
    }
  }, [accessToken, toast]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <View className="flex-1">
      <AppBar />
      <ScrollView contentContainerClassName="px-4 pb-8">
        <Typography.Heading type="h5" className="mb-1 mt-2">
          Professores
        </Typography.Heading>

        {estado.status === "loading" ? (
          <View className="mt-6 items-center gap-3">
            <Spinner />
            {/* The toast dismisses itself long before a cold resolution ends,
                so the wait needs a line that stays put. */}
            <Typography.Paragraph type="body-sm" color="muted" align="center">
              Buscando perfis no SIGAA — só na primeira vez.
            </Typography.Paragraph>
          </View>
        ) : null}

        {estado.status === "error" ? (
          <View className="mt-6 gap-3">
            <Typography.Paragraph type="body-sm" color="muted">
              {estado.message}
            </Typography.Paragraph>
            <Button variant="outline" size="sm" onPress={() => void carregar()}>
              Tentar novamente
            </Button>
          </View>
        ) : null}

        {estado.status === "unsynced" ? (
          <Typography.Paragraph type="body-sm" color="muted" className="mt-6">
            Abra o Início para sincronizar sua grade e ver seus professores.
          </Typography.Paragraph>
        ) : null}

        {estado.status === "empty" ? (
          <Typography.Paragraph type="body-sm" color="muted" className="mt-6">
            Nenhuma matéria neste semestre.
          </Typography.Paragraph>
        ) : null}

        {estado.status === "ready" ? (
          <View className="mt-4">
            {estado.docentes.map((docente) => (
              <DocenteCard
                key={docente.perfil?.siape ?? docente.nomeOriginal}
                resumo={docente}
                onPress={(siape) => router.push(`/professor/${siape}`)}
              />
            ))}

            {estado.semDocente.map((turma) => (
              <View key={turma.codigo} className="mb-3 rounded-2xl border border-border p-4 opacity-55">
                <Typography.Paragraph type="body-sm">{turma.codigo}</Typography.Paragraph>
                <Typography.Paragraph type="body-xs" color="muted">
                  Docente não informado no atestado
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/__tests__/professores.test.tsx`
Expected: PASS, 7 tests.

RTL v14 renders asynchronously in this codebase. Use `findBy*` (as the tests above do) rather than `getBy*` immediately after `render`. If a test needs timers, advance them inside an async `act` and drain pending work before `useRealTimers`.

- [ ] **Step 5: Register the tab**

In `mobile/src/app/(tabs)/_layout.tsx`, add between the `trajetoria` and `documentos` screens:

```tsx
      <Tabs.Screen
        name="professores"
        options={{
          title: "Professores",
          tabBarIcon: ({ color }) => <TabIcon name="IconChalkboardTeacher" color={color} />,
        }}
      />
```

- [ ] **Step 6: Verify the whole mobile suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/app/\(tabs\)/professores.tsx mobile/src/app/\(tabs\)/_layout.tsx mobile/src/__tests__/professores.test.tsx
git commit -m "feat(mobile): add the Professores tab"
```

---

### Task 14: The docente detail screen

Ordered by what the investigation measured as most-often-present and most-wanted: contact first, then what they teach, then the profile extras, then supervision. Sections with no data are omitted, never rendered empty.

**Files:**
- Create: `mobile/src/app/professor/[siape].tsx`
- Test: `mobile/src/__tests__/professor-detalhe.test.tsx`

**Interfaces:**
- Consumes: `getDocente` (Task 11), `DocentePerfil` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `mobile/src/__tests__/professor-detalhe.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import ProfessorDetalhe from "@/app/professor/[siape]";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocentePerfil } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getDocente: jest.fn(),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ siape: "1815041" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/components/AppBar", () => ({ AppBar: () => null }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, View } = jest.requireActual("react-native");
  return {
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, onPress }: any) => <Text onPress={onPress}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

const mockedGet = getDocente as jest.MockedFunction<typeof getDocente>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function perfil(overrides: Partial<DocentePerfil> = {}): DocentePerfil {
  return {
    siape: "1815041",
    nome: "ANTONIO LOPES APOLINARIO JUNIOR",
    departamento: "DCC",
    unidade: "IC",
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: "IC- 2012",
    telefone: "6299",
    email: "antonio.apolinario@ufba.br",
    disciplinas: [
      { semestre: "2026.2", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
      { semestre: "2026.1", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
    ],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0, mestradoConcluidas: 0,
      doutoradoAndamento: 0, doutoradoConcluidas: 0,
    },
    ...overrides,
  };
}

describe("Professor detail screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({ accessToken: "token" } as ReturnType<typeof useAuth>);
  });

  it("leads with contact, the field that is almost always filled", async () => {
    mockedGet.mockResolvedValue(perfil());
    render(<ProfessorDetalhe />);
    expect(await screen.findByText("IC- 2012")).toBeTruthy();
    expect(screen.getByText("antonio.apolinario@ufba.br")).toBeTruthy();
  });

  it("groups the courses taught by term", async () => {
    mockedGet.mockResolvedValue(perfil());
    render(<ProfessorDetalhe />);
    expect(await screen.findByText("2026.2")).toBeTruthy();
    expect(screen.getByText("2026.1")).toBeTruthy();
  });

  // The empty profile is the common case — the screen must not show hollow
  // section headers for data that does not exist.
  it("omits the sections with no data instead of rendering them empty", async () => {
    mockedGet.mockResolvedValue(perfil());
    render(<ProfessorDetalhe />);
    await screen.findByText("IC- 2012");
    expect(screen.queryByText("Formação")).toBeNull();
    expect(screen.queryByText("Áreas de interesse")).toBeNull();
    expect(screen.queryByText("Orientações")).toBeNull();
  });

  it("shows the profile extras when the docente did fill them in", async () => {
    mockedGet.mockResolvedValue(
      perfil({
        formacao: ["Bacharel em Ciência da Computação"],
        areasInteresse: ["Computação Gráfica"],
        lattesUrl: "http://lattes.cnpq.br/123",
        orientacoes: {
          mestradoAndamento: 2, mestradoConcluidas: 5,
          doutoradoAndamento: 1, doutoradoConcluidas: 0,
        },
      }),
    );
    render(<ProfessorDetalhe />);
    expect(await screen.findByText("Formação")).toBeTruthy();
    expect(screen.getByText("Computação Gráfica")).toBeTruthy();
    expect(screen.getByText("Orientações")).toBeTruthy();
  });

  it("shows an error state when the profile cannot be loaded", async () => {
    mockedGet.mockRejectedValue(new Error("boom"));
    render(<ProfessorDetalhe />);
    expect(await screen.findByText(/não foi possível/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/__tests__/professor-detalhe.test.tsx`
Expected: FAIL — cannot find module `@/app/professor/[siape]`.

- [ ] **Step 3: Implement the screen**

Create `mobile/src/app/professor/[siape].tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useEffect, useMemo, useState, type JSX } from "react";
import { Linking, ScrollView, View } from "react-native";

import { AppBar } from "@/components/AppBar";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocenteDisciplina, DocentePerfil } from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; perfil: DocentePerfil }
  | { status: "error" };

function Secao({ titulo, children }: { titulo: string; children: JSX.Element }): JSX.Element {
  return (
    <View className="mt-6">
      <Typography.Heading type="h6" className="mb-2">
        {titulo}
      </Typography.Heading>
      {children}
    </View>
  );
}

function agruparPorSemestre(disciplinas: DocenteDisciplina[]): [string, DocenteDisciplina[]][] {
  const porSemestre = new Map<string, DocenteDisciplina[]>();
  for (const disciplina of disciplinas) {
    porSemestre.set(disciplina.semestre, [
      ...(porSemestre.get(disciplina.semestre) ?? []),
      disciplina,
    ]);
  }
  // Newest term first, matching how SIGAA itself orders the page.
  return [...porSemestre.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export default function ProfessorDetalhe(): JSX.Element {
  const { siape } = useLocalSearchParams<{ siape: string }>();
  const { accessToken } = useAuth();
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const perfil = await getDocente(accessToken ?? "", siape);
        if (!cancelado) setEstado({ status: "ready", perfil });
      } catch {
        if (!cancelado) setEstado({ status: "error" });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [accessToken, siape]);

  const semestres = useMemo(
    () => (estado.status === "ready" ? agruparPorSemestre(estado.perfil.disciplinas) : []),
    [estado],
  );

  if (estado.status === "loading") {
    return (
      <View className="flex-1">
        <AppBar />
        <View className="mt-10 items-center">
          <Spinner />
        </View>
      </View>
    );
  }

  if (estado.status === "error") {
    return (
      <View className="flex-1">
        <AppBar />
        <Typography.Paragraph type="body-sm" color="muted" align="center" className="mt-10 px-4">
          Não foi possível carregar este perfil agora.
        </Typography.Paragraph>
      </View>
    );
  }

  const { perfil } = estado;
  const contato = [
    perfil.sala ? ["Sala", perfil.sala] : null,
    perfil.telefone ? ["Telefone/Ramal", perfil.telefone] : null,
    perfil.email ? ["E-mail", perfil.email] : null,
    perfil.enderecoProfissional ? ["Endereço", perfil.enderecoProfissional] : null,
  ].filter((par): par is [string, string] => par !== null);

  const { orientacoes } = perfil;
  const totalOrientacoes =
    orientacoes.mestradoAndamento +
    orientacoes.mestradoConcluidas +
    orientacoes.doutoradoAndamento +
    orientacoes.doutoradoConcluidas;

  return (
    <View className="flex-1">
      <AppBar />
      <ScrollView contentContainerClassName="px-4 pb-10">
        <Typography.Heading type="h5" className="mt-2">
          {perfil.nome}
        </Typography.Heading>
        {perfil.departamento ? (
          <Typography.Paragraph type="body-sm" color="muted">
            {perfil.departamento}
          </Typography.Paragraph>
        ) : null}

        {/* Contact first: it was filled for 4 of 4 docentes measured, and sala
            plus e-mail is what a student actually came looking for. */}
        {contato.length > 0 ? (
          <Secao titulo="Contato">
            <View className="gap-1">
              {contato.map(([rotulo, valor]) => (
                <View key={rotulo} className="flex-row justify-between gap-4">
                  <Typography.Paragraph type="body-xs" color="muted">
                    {rotulo}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-sm" align="right" className="flex-1">
                    {valor}
                  </Typography.Paragraph>
                </View>
              ))}
            </View>
          </Secao>
        ) : null}

        {semestres.length > 0 ? (
          <Secao titulo="Disciplinas ministradas">
            <View className="gap-3">
              {semestres.map(([semestre, disciplinas]) => (
                <View key={semestre}>
                  <Typography.Paragraph type="body-xs" color="muted">
                    {semestre}
                  </Typography.Paragraph>
                  {disciplinas.map((disciplina) => (
                    <Typography.Paragraph
                      key={`${semestre}-${disciplina.codigo}`}
                      type="body-sm"
                    >
                      {disciplina.codigo} · {disciplina.nome}
                    </Typography.Paragraph>
                  ))}
                </View>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.descricaoPessoal ? (
          <Secao titulo="Sobre">
            <Typography.Paragraph type="body-sm">
              {perfil.descricaoPessoal}
            </Typography.Paragraph>
          </Secao>
        ) : null}

        {perfil.formacao.length > 0 ? (
          <Secao titulo="Formação">
            <View className="gap-1">
              {perfil.formacao.map((linha) => (
                <Typography.Paragraph key={linha} type="body-sm">
                  {linha}
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.areasInteresse.length > 0 ? (
          <Secao titulo="Áreas de interesse">
            <View className="gap-1">
              {perfil.areasInteresse.map((area) => (
                <Typography.Paragraph key={area} type="body-sm">
                  {area}
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}

        {perfil.lattesUrl ? (
          <Secao titulo="Currículo Lattes">
            <Typography.Paragraph
              type="body-sm"
              className="underline"
              onPress={() => void Linking.openURL(perfil.lattesUrl as string)}
            >
              Abrir no Lattes
            </Typography.Paragraph>
          </Secao>
        ) : null}

        {/* Supervision is the closest thing this page has to "would they take
            me on": the TCC titles map what they supervise, the in-progress
            counts hint at whether they have room. */}
        {totalOrientacoes > 0 || perfil.tccsOrientados.length > 0 ? (
          <Secao titulo="Orientações">
            <View className="gap-1">
              {orientacoes.mestradoAndamento > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Mestrado em andamento: {orientacoes.mestradoAndamento}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.mestradoConcluidas > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Mestrado concluídas: {orientacoes.mestradoConcluidas}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.doutoradoAndamento > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Doutorado em andamento: {orientacoes.doutoradoAndamento}
                </Typography.Paragraph>
              ) : null}
              {orientacoes.doutoradoConcluidas > 0 ? (
                <Typography.Paragraph type="body-sm">
                  Doutorado concluídas: {orientacoes.doutoradoConcluidas}
                </Typography.Paragraph>
              ) : null}
              {perfil.tccsOrientados.slice(0, 10).map((tcc) => (
                <Typography.Paragraph
                  key={`${tcc.ano}-${tcc.titulo}`}
                  type="body-xs"
                  color="muted"
                >
                  {tcc.titulo} ({tcc.ano})
                </Typography.Paragraph>
              ))}
            </View>
          </Secao>
        ) : null}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/__tests__/professor-detalhe.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify everything, both sides**

Run from `mobile/`: `npm test && npm run typecheck && npm run lint`
Run from `backend/`: `npm test && npm run build && npm run lint`
Expected: all green.

- [ ] **Step 6: Mark the roadmap item done**

In `ROADMAP.md`, change the item 7 heading to `## 7. Página de professores (perfil, não avaliação) ✅ feito`, matching how item 6 is marked.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/app/professor mobile/src/__tests__/professor-detalhe.test.tsx ROADMAP.md
git commit -m "feat(mobile): add the docente detail screen"
```

---

## Manual verification before calling it done

The test suite never touches the real SIGAA, so one manual pass is required:

- [ ] Run the app against the real backend with a linked SIGAA account and open the Professores tab **cold** (empty `docentes` table). Confirm the toast appears, the wait is bounded, and cards resolve.
- [ ] Open it a second time. Confirm it is now fast — the global cache should make the second load essentially instant.
- [ ] Confirm at least one card is disabled if any of your docentes has no public record, and that tapping it does nothing.
- [ ] Open a rich profile and an empty one. Confirm the empty one shows contact and courses without hollow section headers.
- [ ] Check the backend logs for `Failed to search` / `SIGAA rejected` warnings and confirm `docente_lookup` has no `siape IS NULL` row for a docente you know exists.
