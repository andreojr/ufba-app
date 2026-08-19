# Trajetória Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fully-mocked Trajetória screen with real data parsed from the student's SIGAA transcript PDF, synced on demand and persisted server-side.

**Architecture:** Four layers, each testable alone. A PDF extraction layer isolates the only new dependency and yields positioned text items; a pure synchronous parser turns those items into a domain object and refuses to return anything that fails the document's own internal invariants; a service persists the result as a per-user snapshot alongside a user-authored planning table that survives re-syncs; the screen reads our own database, never SIGAA directly.

**Tech Stack:** NestJS, Prisma/Postgres, Jest (backend); Expo/React Native, HeroUI Native, React Native Testing Library (mobile); `pdf-parse` v2 wrapping pdfjs for PDF text extraction.

**Spec:** `docs/superpowers/specs/2026-08-19-trajetoria-design.md`

**Background:** `docs/superpowers/spikes/2026-08-19-historico-pdf-parser.md` documents the real transcript's structure — column x-bands, section anchors, which fields exist and which do not. Read it before Task 2.

## Global Constraints

- Domain names in pt-BR (`ComponenteCursado`, `parseHistorico`, `cargaHoraria`), matching the existing parsers. Code comments in English, and they explain **why**, not what.
- New backend dependency: **`pdf-parse@^2.4.5`** exactly. It is the only file allowed to know a PDF is involved (`parsers/historico-texto.ts`).
- **Never extract, log, or persist CPF, RG, or date/place of birth.** The matrícula is already on `User`; the rest is sensitive data no screen uses.
- **The screen discloses this before the first sync**, naming both sides — what is kept (matérias, notas, carga horária) and what is discarded (CPF, RG, nascimento). A generic "nothing sensitive is stored" is not acceptable copy: it would be false by omission, since grades are stored. Task 13 tests the copy; Task 3 tests that the parser keeps it true.
- **No parsing decision may depend on `fontName`'s value.** pdfjs reports `fontFamily: "sans-serif"` for all three of the transcript's fonts, and the only distinguishing handle is a per-document generated id (`g_d0_f3`). Verified against the real document. `fontName` is carried for debugging only.
- Column x-bands need tolerance: columns drift ~3 pt between pages. Never compare an x for equality.
- Section boundaries come from **text anchors**, never page positions — the legend spills onto the last page and the footer's y shifts between pages.
- A transcript shape the parser does not recognise must **throw** with a descriptive message. Never persist a partial trajectory that looks plausible. This follows `fetchHistorico`, which already prefers a descriptive failure over returning bytes that are not a PDF.
- Backend tests run from `backend/`: `npm test`. Mobile tests run from `mobile/`: `npm test`.
- The real transcript PDF never enters the repository, in any form.

---

## File Structure

**Backend — create:**

| File | Responsibility |
|---|---|
| `src/sigaa-engine/parsers/historico-texto.ts` | The only file importing `pdf-parse`. `Buffer` → `ItemTexto[]`. |
| `src/sigaa-engine/parsers/historico-texto.spec.ts` | Covers the `pdf-parse` → `ItemTexto` bridge against a synthetic PDF. |
| `src/sigaa-engine/parsers/historico.ts` | Pure parser: `ItemTexto[]` → `Historico`, plus the invariant checks. |
| `src/sigaa-engine/parsers/historico.spec.ts` | Behaviour specs over the anonymised fixture. |
| `src/sigaa-engine/parsers/__fixtures__/historico-itens.json` | Anonymised `ItemTexto[]` dump of a real transcript. |
| `src/sigaa-engine/historico.service.ts` | Orchestration: download → extract → parse → validate → persist. Plan reconciliation. |
| `src/sigaa-engine/historico.service.spec.ts` | Service specs with a stubbed repository and engine. |
| `src/sigaa-engine/trajetoria.controller.ts` | `POST /trajetoria/sync`, `GET /trajetoria`. |
| `src/sigaa-engine/trajetoria.controller.spec.ts` | Controller specs. |
| `src/sigaa-engine/historico.repository.ts` | Domain-side interface for persistence. |
| `src/db/prisma-historico.repository.ts` | Prisma implementation. |
| `scripts/dump-historico-fixture.ts` | One-off: dump + anonymise the fixture. Not part of the app. |

**Backend — modify:** `prisma/schema.prisma`, `src/db/tokens.ts`, `src/db/database.module.ts`, `src/sigaa-engine/sigaa-engine.module.ts`, `package.json`.

**Mobile — create:** `src/lib/trajetoria.ts` (derivations) + `src/lib/trajetoria.test.ts`, `src/__tests__/trajetoria.test.tsx`.

**Mobile — modify:** `src/lib/api.ts`, `src/lib/types.ts`, `src/app/(tabs)/trajetoria.tsx`, `src/lib/mock-data.ts` (drop the now-unused transcript mocks).

Splitting extraction from parsing is the decomposition that matters: it is what makes every interesting parser case (a row with no natureza, a component with no docente, the same code in two semesters) testable from a JSON fixture with no PDF and no async.

---

# Stage 1 — Parsers

## Task 1: PDF text extraction

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/sigaa-engine/parsers/historico-texto.ts`
- Create: `backend/src/sigaa-engine/parsers/historico-texto.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ItemTexto { pagina: number; x: number; y: number; texto: string; fontName: string }` and `extrairItensHistorico(pdf: Buffer): Promise<ItemTexto[]>`. Every later parser task consumes `ItemTexto[]`.

- [ ] **Step 1: Install the dependency**

```bash
cd backend && npm install pdf-parse@^2.4.5
```

- [ ] **Step 2: Write the failing test**

The synthetic PDF is built by hand as a minimal PDF 1.4 with one text-showing operator, so the test needs no binary fixture and no real transcript. `create: backend/src/sigaa-engine/parsers/historico-texto.spec.ts`:

```ts
import { extrairItensHistorico } from './historico-texto';

/**
 * A minimal one-page PDF that shows "MATA55" at (72, 700). Hand-built rather
 * than committed as a binary so the bridge to pdf-parse is covered without
 * any real transcript entering the repository.
 */
function pdfSintetico(): Buffer {
  const conteudo = 'BT /F1 12 Tf 72 700 Td (MATA55) Tj ET';
  const objetos = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${conteudo.length} >> stream\n${conteudo}\nendstream endobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const objeto of objetos) {
    offsets.push(pdf.length);
    pdf += objeto;
  }
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

describe('extrairItensHistorico', () => {
  it('returns one positioned item per non-empty text run', async () => {
    const itens = await extrairItensHistorico(pdfSintetico());

    expect(itens).toHaveLength(1);
    expect(itens[0]).toEqual({
      pagina: 1,
      x: 72,
      y: 700,
      texto: 'MATA55',
      fontName: expect.any(String),
    });
  });

  it('rejects a buffer that is not a PDF instead of returning nothing', async () => {
    await expect(extrairItensHistorico(Buffer.from('<html>nope</html>'))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- historico-texto`
Expected: FAIL — cannot find module `./historico-texto`.

- [ ] **Step 4: Write the implementation**

`create: backend/src/sigaa-engine/parsers/historico-texto.ts`:

```ts
import { PDFParse } from 'pdf-parse';

/**
 * One text run from the transcript PDF, with the position it was painted at.
 *
 * Position is the whole point. The transcript is generated by JasperReports via
 * iText, which paints in an order that dissociates a label from its value — the
 * flat text of any extractor puts "Nome:" three lines away from the name, and
 * the component table's columns interleave. Reading cells off x/y bands is the
 * only way to recover the tabular structure.
 *
 * `fontName` is carried for debugging and fixture inspection only. It must never
 * drive a parsing decision: the transcript's fonts are not embedded, so pdfjs
 * reports `fontFamily: "sans-serif"` for all of them and the only handle that
 * distinguishes the oblique one is a per-document generated id (`g_d0_f3`).
 */
export interface ItemTexto {
  pagina: number;
  x: number;
  y: number;
  texto: string;
  fontName: string;
}

/** The shape this module needs off a pdfjs text item; pdf-parse re-exports pdfjs's own wider type. */
interface ItemPdfJs {
  str?: string;
  transform: number[];
  fontName: string;
}

export async function extrairItensHistorico(pdf: Buffer): Promise<ItemTexto[]> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  const itens: ItemTexto[] = [];

  try {
    const documento = await parser.load();

    for (let pagina = 1; pagina <= documento.numPages; pagina += 1) {
      const { items } = await (await documento.getPage(pagina)).getTextContent();

      for (const item of items as ItemPdfJs[]) {
        const texto = item.str?.trim();
        if (!texto) {
          continue;
        }
        // transform is the text matrix; [4] and [5] are the translation
        // components, i.e. where on the page this run starts.
        itens.push({
          pagina,
          x: item.transform[4],
          y: item.transform[5],
          texto,
          fontName: item.fontName,
        });
      }
    }
  } finally {
    // pdfjs spawns a worker. Left alive it keeps the Jest process from exiting.
    await parser.destroy();
  }

  return itens;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- historico-texto`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json \
  backend/src/sigaa-engine/parsers/historico-texto.ts \
  backend/src/sigaa-engine/parsers/historico-texto.spec.ts
git commit -m "feat(backend): extract positioned text items from the histórico PDF"
```

---

## Task 2: Generate the anonymised fixture

**Files:**
- Create: `backend/scripts/dump-historico-fixture.ts`
- Create: `backend/src/sigaa-engine/parsers/__fixtures__/historico-itens.json`

**Interfaces:**
- Consumes: `extrairItensHistorico` from Task 1.
- Produces: the fixture file every spec in Tasks 3–6 reads.

This task has no test of its own — it produces test input. Its deliverable is verified by inspection in Step 4.

- [ ] **Step 1: Write the dump script**

Anonymisation happens **inside** the script, before anything is written, so the real values never land on disk in the repo. Only `texto` fields change; the x/y coordinates the parser depends on are independent of content, which is why substituting a name of a different length is harmless here.

`create: backend/scripts/dump-historico-fixture.ts`:

```ts
/**
 * One-off: turn a real transcript PDF into the anonymised fixture the parser
 * specs read. Not part of the application.
 *
 * Usage: npx ts-node scripts/dump-historico-fixture.ts <caminho-do-pdf>
 *
 * The real PDF must never be committed, and neither may a dump carrying its
 * personal data — hence the substitutions below, applied before writing.
 * Coordinates are left untouched: the parser reads cells off x/y bands, and
 * those do not depend on the text's content or length.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extrairItensHistorico } from '../src/sigaa-engine/parsers/historico-texto';

// Fill in the left-hand side with the real values found in the source PDF.
// Every entry is a plain string replacement over each item's `texto`.
const SUBSTITUICOES: [string, string][] = [
  ['ANDRE LUIZ DE OLIVEIRA JUNIOR', 'MARIA DA SILVA SANTOS'],
  ['223116037', '209900011'],
  // CPF, RG and birth date: copy the exact strings as they appear in the PDF.
  ['000.000.000-00', '111.222.333-44'],
  ['0000000000, (SSP/BA)', '9999999999, (SSP/BA)'],
  ['01/01/2000', '15/03/2001'],
  ['49c587ba37', 'aaaa1111bb'],
];

async function main(): Promise<void> {
  const caminho = process.argv[2];
  if (!caminho) {
    throw new Error('Informe o caminho do PDF do histórico.');
  }

  const itens = await extrairItensHistorico(readFileSync(caminho));

  const anonimos = itens.map((item) => {
    let texto = item.texto;
    for (const [de, para] of SUBSTITUICOES) {
      texto = texto.split(de).join(para);
    }
    return { ...item, texto };
  });

  const destino = join(
    __dirname,
    '..',
    'src',
    'sigaa-engine',
    'parsers',
    '__fixtures__',
    'historico-itens.json',
  );
  writeFileSync(destino, `${JSON.stringify(anonimos, null, 2)}\n`);
  console.log(`${anonimos.length} itens escritos em ${destino}`);
}

void main();
```

- [ ] **Step 2: Fill in the real values to substitute**

Open the source PDF and read the Dados Pessoais section. Replace the left-hand side of each `SUBSTITUICOES` entry with the exact string as it appears. Ask André for the PDF path — as of this writing it is `~/Downloads/historico_223116037-4.pdf`.

- [ ] **Step 3: Run the script**

```bash
cd backend && npx ts-node scripts/dump-historico-fixture.ts ~/Downloads/historico_223116037-4.pdf
```

Expected: `~1300 itens escritos em .../historico-itens.json`.

- [ ] **Step 4: Verify the fixture carries no personal data**

```bash
cd backend && grep -c "ANDRE\|223116037\|49c587ba37" src/sigaa-engine/parsers/__fixtures__/historico-itens.json
```

Expected: `0`. If it prints anything else, a substitution string did not match the PDF exactly — fix it and re-run Step 3. **Do not commit until this prints 0.**

Then sanity-check the shape:

```bash
cd backend && node -e "const i=require('./src/sigaa-engine/parsers/__fixtures__/historico-itens.json'); console.log(i.length, 'itens,', new Set(i.map(x=>x.pagina)).size, 'páginas'); console.log(i.filter(x=>/^\d{4}\.\d$/.test(x.texto) && x.x<60).length, 'âncoras de linha')"
```

Expected: 3 páginas, 49 âncoras de linha.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/dump-historico-fixture.ts \
  backend/src/sigaa-engine/parsers/__fixtures__/historico-itens.json
git commit -m "test(backend): add anonymised histórico item fixture"
```

---

## Task 3: Parse the header, vínculo and índices

**Files:**
- Create: `backend/src/sigaa-engine/parsers/historico.ts`
- Create: `backend/src/sigaa-engine/parsers/historico.spec.ts`

**Interfaces:**
- Consumes: `ItemTexto` from Task 1; the fixture from Task 2.
- Produces: `parseHistorico(itens: ItemTexto[]): Historico`, and the exported types `SituacaoComponente`, `NaturezaComponente`, `ComponenteCursado`, `ComponentePendente`, `ResumoCargaHoraria`, `Historico`. Tasks 4–6 extend the same function; Tasks 8 and 10 consume `Historico`.

Note the label/value geometry: a label ("Nome:", "CR:") and its value sit at the **same y** with the value further right. That is the one place iText's paint order does not matter, because y pairs them.

- [ ] **Step 1: Write the failing test**

`create: backend/src/sigaa-engine/parsers/historico.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistorico } from './historico';
import type { ItemTexto } from './historico-texto';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'historico-itens.json');

describe('parseHistorico', () => {
  const itens = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as ItemTexto[];

  it('reads the academic indices straight off the header', () => {
    const historico = parseHistorico(itens);

    // The document prints both; CR is the coefficient the screen shows. IAP is
    // on a 0–1 scale and its formula was never reverse-engineered — it is
    // carried through as-is.
    expect(historico.indices.cr).toBeCloseTo(8.1597, 4);
    expect(historico.indices.iap).toBeCloseTo(0.8434, 4);
  });

  it('reads the vínculo fields the screen needs to bound a planning horizon', () => {
    const historico = parseHistorico(itens);

    expect(historico.curriculo).toBe('G20251 - 2025.2');
    expect(historico.periodoLetivoAtual).toBe(8);
    expect(historico.prazoConclusaoPadrao).toBe('2030.1');
    expect(historico.prazoConclusaoMaximo).toBe('2033.1');
  });

  it('reads the issue date and the verification code from the footer', () => {
    const historico = parseHistorico(itens);

    expect(historico.emitidoEm).toBe('2026-08-19');
    expect(historico.codigoVerificacao).toMatch(/^[0-9a-z]{10}$/);
  });

  it('never surfaces the personal data the screen has no use for', () => {
    const historico = parseHistorico(itens);

    // CPF, RG and birth date are read past on purpose — see the spec's
    // privacy section. This asserts the shape stays free of them.
    expect(Object.keys(historico)).not.toContain('cpf');
    expect(JSON.stringify(historico)).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- historico.spec`
Expected: FAIL — cannot find module `./historico`.

- [ ] **Step 3: Write the implementation**

`create: backend/src/sigaa-engine/parsers/historico.ts`:

```ts
import type { ItemTexto } from './historico-texto';

/**
 * Every situação in the transcript's own legend, not just the four a given
 * document happens to use. Stored as a string in the database rather than a
 * Prisma enum: SIGAA can add a value in a migration, and an enum would turn
 * that into an insert failure instead of a row we can still show.
 */
export type SituacaoComponente =
  | 'APR'
  | 'CANC'
  | 'DISP'
  | 'MATR'
  | 'REP'
  | 'REPF'
  | 'REPMF'
  | 'TRANC'
  | 'TRANS'
  | 'INCORP'
  | 'CUMP';

export type NaturezaComponente = 'OB' | 'OP' | 'EB' | 'EP' | 'LV' | 'EC';

const SITUACOES: readonly string[] = [
  'APR', 'CANC', 'DISP', 'MATR', 'REP', 'REPF',
  'REPMF', 'TRANC', 'TRANS', 'INCORP', 'CUMP',
];

const NATUREZAS: readonly string[] = ['OB', 'OP', 'EB', 'EP', 'LV', 'EC'];

export interface ComponenteCursado {
  semestre: string;
  /** Null on trancamento rows: the column emits no item at all, it is not "-". */
  natureza: NaturezaComponente | null;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null when the document prints "--" — trancado and matriculado rows. */
  nota: number | null;
  situacao: SituacaoComponente;
  /** Raw, capitalisation included. Absent on some rows. */
  docente: string | null;
}

export interface ComponentePendente {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** The "Matriculado" annotation: pending, but being taken right now. */
  matriculado: boolean;
}

export interface ResumoCargaHoraria {
  exigida: number;
  integralizada: number;
  pendente: number;
}

export interface Historico {
  /** ISO date, so a client can build a Date without guessing day/month order. */
  emitidoEm: string;
  codigoVerificacao: string;
  curriculo: string;
  periodoLetivoAtual: number;
  prazoConclusaoPadrao: string;
  prazoConclusaoMaximo: string;
  indices: { cr: number | null; iap: number | null };
  cursados: ComponenteCursado[];
  pendentesObrigatorios: ComponentePendente[];
  cargaHoraria: {
    obrigatorias: ResumoCargaHoraria;
    optativas: ResumoCargaHoraria;
    complementares: ResumoCargaHoraria;
    total: ResumoCargaHoraria;
  };
  equivalencias: string[];
  observacoes: string[];
}

/** Same y, further right: the one pairing iText's paint order cannot break. */
function valorAoLadoDe(
  itens: ItemTexto[],
  rotulo: string,
  opcoes: { toleranciaY?: number } = {},
): string | null {
  const tolerancia = opcoes.toleranciaY ?? 1.5;
  const item = itens.find((i) => i.texto.startsWith(rotulo));
  if (!item) {
    return null;
  }

  // The label sometimes carries its own value ("Ingresso: 2023.1 - 14/03/2023").
  const embutido = item.texto.slice(rotulo.length).trim();
  if (embutido) {
    return embutido;
  }

  const vizinhos = itens
    .filter(
      (i) =>
        i !== item &&
        i.pagina === item.pagina &&
        Math.abs(i.y - item.y) <= tolerancia &&
        i.x > item.x,
    )
    .sort((a, b) => a.x - b.x);

  return vizinhos[0]?.texto ?? null;
}

function exigirValor(itens: ItemTexto[], rotulo: string): string {
  const valor = valorAoLadoDe(itens, rotulo);
  if (valor === null) {
    throw new Error(
      `Histórico não reconhecido: não achei o valor de "${rotulo}". ` +
        'O layout do documento pode ter mudado.',
    );
  }
  return valor;
}

function numeroOuNulo(valor: string | null): number | null {
  if (valor === null) {
    return null;
  }
  const numero = Number(valor.replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}

function paraIso(dataBr: string): string {
  const [dia, mes, ano] = dataBr.split('/');
  return `${ano}-${mes}-${dia}`;
}

const EMITIDO_EM_PATTERN = /Emitido em:\s*(\d{2}\/\d{2}\/\d{4})/;
const CODIGO_VERIFICACAO_PATTERN = /código de verificação:\s*([0-9a-z]+)/i;
// "2030.1 / 2033.1" — padrão e máximo on one line.
const PRAZOS_PATTERN = /(\d{4}\.\d)\s*\/\s*(\d{4}\.\d)/;

function casarEmAlgumItem(itens: ItemTexto[], pattern: RegExp): RegExpExecArray {
  for (const item of itens) {
    const match = pattern.exec(item.texto);
    if (match) {
      return match;
    }
  }
  throw new Error(
    `Histórico não reconhecido: nenhum trecho casou com ${String(pattern)}.`,
  );
}

export function parseHistorico(itens: ItemTexto[]): Historico {
  const emitidoEm = paraIso(casarEmAlgumItem(itens, EMITIDO_EM_PATTERN)[1]);
  const codigoVerificacao = casarEmAlgumItem(itens, CODIGO_VERIFICACAO_PATTERN)[1];
  const prazos = casarEmAlgumItem(itens, PRAZOS_PATTERN);

  return {
    emitidoEm,
    codigoVerificacao,
    curriculo: exigirValor(itens, 'Currículo:'),
    periodoLetivoAtual: Number(exigirValor(itens, 'Período Letivo Atual:')),
    prazoConclusaoPadrao: prazos[1],
    prazoConclusaoMaximo: prazos[2],
    indices: {
      cr: numeroOuNulo(valorAoLadoDe(itens, 'CR:')),
      iap: numeroOuNulo(valorAoLadoDe(itens, 'IAP:')),
    },
    cursados: [],
    pendentesObrigatorios: [],
    cargaHoraria: {
      obrigatorias: { exigida: 0, integralizada: 0, pendente: 0 },
      optativas: { exigida: 0, integralizada: 0, pendente: 0 },
      complementares: { exigida: 0, integralizada: 0, pendente: 0 },
      total: { exigida: 0, integralizada: 0, pendente: 0 },
    },
    equivalencias: [],
    observacoes: [],
  };
}

export { SITUACOES, NATUREZAS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- historico.spec`
Expected: PASS, 4 tests. If `Currículo:` or `Período Letivo Atual:` throws, the label in the fixture differs — inspect it with the command in Task 2 Step 4 and adjust the label string, not the helper.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/historico.ts \
  backend/src/sigaa-engine/parsers/historico.spec.ts
git commit -m "feat(backend): parse the histórico header, vínculo and índices"
```

---

## Task 4: Parse the component table

**Files:**
- Modify: `backend/src/sigaa-engine/parsers/historico.ts`
- Modify: `backend/src/sigaa-engine/parsers/historico.spec.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: `Historico.cursados` populated. Task 6 validates against it; Task 8 persists it.

This is the task the spike's geometry findings exist for. Column bands, and the docente rule verified against all 49 rows of the real document.

- [ ] **Step 1: Write the failing test**

`modify: backend/src/sigaa-engine/parsers/historico.spec.ts` — add inside the existing `describe`:

```ts
  it('parses every component row in the table', () => {
    const { cursados } = parseHistorico(itens);

    expect(cursados).toHaveLength(49);
  });

  it('parses a plain approved row end to end', () => {
    const { cursados } = parseHistorico(itens);
    const fisica = cursados.find((c) => c.codigo === 'FISD36');

    expect(fisica).toEqual({
      semestre: '2023.1',
      natureza: 'OB',
      codigo: 'FISD36',
      nome: expect.stringContaining('FÍSICA'),
      cargaHoraria: 60,
      nota: 6.8,
      situacao: 'APR',
      docente: expect.stringContaining('(60h)'),
    });
  });

  it('reports a null natureza when the column emits no item at all', () => {
    const { cursados } = parseHistorico(itens);
    const trancados = cursados.filter((c) => c.situacao === 'TRANC');

    // Trancamento rows leave the natureza column empty — not "-", absent.
    expect(trancados.length).toBeGreaterThan(0);
    expect(trancados.every((c) => c.natureza === null)).toBe(true);
  });

  it('reports a null nota when the document prints "--"', () => {
    const { cursados } = parseHistorico(itens);

    for (const componente of cursados) {
      if (componente.situacao === 'TRANC' || componente.situacao === 'MATR') {
        expect(componente.nota).toBeNull();
      }
    }
  });

  it('reports a null docente when the row carries no docente line', () => {
    const { cursados } = parseHistorico(itens);
    const semDocente = cursados.filter((c) => c.docente === null);

    // Exactly one row in the fixture has no docente. Its name must still parse:
    // with no docente line the name sits on the baseline instead of above it.
    expect(semDocente).toHaveLength(1);
    expect(semDocente[0].nome).not.toBe('');
  });

  it('keeps both attempts when the same code recurs across semesters', () => {
    const { cursados } = parseHistorico(itens);
    const repetido = cursados.filter((c) => c.codigo === 'MATA97');

    expect(repetido).toHaveLength(2);
    expect(repetido.map((c) => c.situacao).sort()).toEqual(['REP', 'TRANC']);
  });

  it('gives every row a name and a recognised situação', () => {
    const { cursados } = parseHistorico(itens);

    for (const componente of cursados) {
      expect(componente.nome).not.toBe('');
      expect(SITUACOES).toContain(componente.situacao);
    }
  });
```

Add `SITUACOES` to the import at the top of the spec:

```ts
import { parseHistorico, SITUACOES } from './historico';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- historico.spec`
Expected: FAIL — `cursados` has length 0.

- [ ] **Step 3: Write the implementation**

`modify: backend/src/sigaa-engine/parsers/historico.ts` — add above `parseHistorico`:

```ts
const SEMESTRE_PATTERN = /^\d{4}\.\d$/;

/**
 * A docente line ends in its workload — "Dr. FULANO DE TAL (60h)".
 *
 * This is how a docente line is told apart from a component name that wrapped
 * onto a second line, and it is deliberately not a font check: pdfjs cannot
 * tell us which of the transcript's fonts is the oblique one (they are not
 * embedded, so all report `fontFamily: "sans-serif"`), and the only handle is a
 * per-document generated id. Verified against the real document: this rule
 * agrees with font-based classification on all 49 rows.
 */
const DOCENTE_SUFFIX_PATTERN = /\(\s*\d+\s*h\s*\)\s*$/i;

/**
 * Column x-bands of the component table, in points. Ranges rather than exact
 * positions because columns drift ~3pt between pages.
 */
const COLUNAS = {
  natureza: [65, 90],
  codigo: [90, 125],
  nome: [125, 480],
  cargaHoraria: [480, 500],
  nota: [500, 532],
  situacao: [532, 580],
} as const;

const TITULO_CURSADOS = 'Componentes Curriculares Cursados/Cursando';

function celula(itens: ItemTexto[], banda: readonly [number, number], y: number): string {
  return itens
    .filter(
      (i) => i.x >= banda[0] && i.x < banda[1] && Math.abs(i.y - y) <= 1.5,
    )
    .sort((a, b) => a.x - b.x)
    .map((i) => i.texto)
    .join(' ');
}

function exigirSituacao(bruta: string, codigo: string): SituacaoComponente {
  if (!SITUACOES.includes(bruta)) {
    throw new Error(
      `Histórico não reconhecido: situação "${bruta}" no componente ${codigo} ` +
        'não está na legenda conhecida.',
    );
  }
  return bruta as SituacaoComponente;
}

function parseCursados(itens: ItemTexto[]): ComponenteCursado[] {
  const cursados: ComponenteCursado[] = [];

  const paginas = [...new Set(itens.map((i) => i.pagina))].sort((a, b) => a - b);
  for (const pagina of paginas) {
    const daPagina = itens.filter((i) => i.pagina === pagina);

    const titulo = daPagina.find((i) => i.texto.includes(TITULO_CURSADOS));
    if (!titulo) {
      continue;
    }
    // Bound the section by the next section's own anchor, never by a fixed y:
    // the legend spills onto the following page and the footer's y shifts.
    const legenda = daPagina.find((i) => i.texto === 'Legenda');
    const naSecao = daPagina.filter(
      (i) => i.y < titulo.y && i.y > (legenda ? legenda.y : 45),
    );

    // Every row is anchored by its own semestre at the left edge, which is why
    // a row split across pages needs no special handling.
    const ancoras = naSecao
      .filter((i) => SEMESTRE_PATTERN.test(i.texto) && i.x < 60)
      .sort((a, b) => b.y - a.y);

    for (const ancora of ancoras) {
      // The name sits 3.5pt above the baseline when a second line exists, and
      // on the baseline when it does not — so the band has to cover both.
      const acima = naSecao
        .filter(
          (i) =>
            i.x >= COLUNAS.nome[0] &&
            i.x < COLUNAS.nome[1] &&
            i.y >= ancora.y - 1 &&
            i.y <= ancora.y + 8,
        )
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const abaixo = naSecao
        .filter(
          (i) =>
            i.x >= COLUNAS.nome[0] &&
            i.x < COLUNAS.nome[1] &&
            i.y < ancora.y - 1 &&
            i.y >= ancora.y - 8,
        )
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const textoAbaixo = abaixo.map((i) => i.texto).join(' ');
      const ehDocente = textoAbaixo !== '' && DOCENTE_SUFFIX_PATTERN.test(textoAbaixo);

      const nome = [
        acima.map((i) => i.texto).join(' '),
        // Not a docente: the component name wrapped onto a second line.
        ehDocente ? '' : textoAbaixo,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      const natureza = celula(naSecao, COLUNAS.natureza, ancora.y);
      const codigo = celula(naSecao, COLUNAS.codigo, ancora.y);
      const nota = celula(naSecao, COLUNAS.nota, ancora.y);

      cursados.push({
        semestre: ancora.texto,
        natureza: NATUREZAS.includes(natureza)
          ? (natureza as NaturezaComponente)
          : null,
        codigo,
        nome,
        cargaHoraria: Number(celula(naSecao, COLUNAS.cargaHoraria, ancora.y)),
        nota: /^\d/.test(nota) ? Number(nota) : null,
        situacao: exigirSituacao(celula(naSecao, COLUNAS.situacao, ancora.y), codigo),
        docente: ehDocente ? textoAbaixo : null,
      });
    }
  }

  return cursados;
}
```

Then in `parseHistorico`, replace `cursados: []` with:

```ts
    cursados: parseCursados(itens),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- historico.spec`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/historico.ts \
  backend/src/sigaa-engine/parsers/historico.spec.ts
git commit -m "feat(backend): parse the histórico component table"
```

---

## Task 5: Parse pendentes, workload matrix, equivalências and observações

**Files:**
- Modify: `backend/src/sigaa-engine/parsers/historico.ts`
- Modify: `backend/src/sigaa-engine/parsers/historico.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–4.
- Produces: `Historico.pendentesObrigatorios`, `.cargaHoraria`, `.equivalencias`, `.observacoes` populated.

- [ ] **Step 1: Write the failing test**

`modify: backend/src/sigaa-engine/parsers/historico.spec.ts` — add inside the existing `describe`:

```ts
  it('parses every pending obligatory component', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);

    expect(pendentesObrigatorios).toHaveLength(20);
  });

  it('flags a pending component that is being taken right now', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);

    // The section annotates these with "Matriculado"; the screen must keep them
    // out of the planning pool.
    expect(pendentesObrigatorios.filter((p) => p.matriculado)).toHaveLength(4);
  });

  it('keeps both ENADE rows, which share a code but not a name', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);
    const enade = pendentesObrigatorios.filter((p) => p.codigo === 'ENADE');

    // Code alone is not a key here — this is why the natural key carries nome.
    expect(enade).toHaveLength(2);
    expect(new Set(enade.map((p) => p.nome)).size).toBe(2);
    expect(enade.every((p) => p.cargaHoraria === 0)).toBe(true);
  });

  it('parses the workload matrix, including the totals the document asserts', () => {
    const { cargaHoraria } = parseHistorico(itens);

    expect(cargaHoraria.obrigatorias).toEqual({
      exigida: 3150,
      integralizada: 2100,
      pendente: 1050,
    });
    expect(cargaHoraria.optativas).toEqual({
      exigida: 360,
      integralizada: 0,
      pendente: 360,
    });
    expect(cargaHoraria.complementares).toEqual({
      exigida: 100,
      integralizada: 0,
      pendente: 100,
    });
    expect(cargaHoraria.total).toEqual({
      exigida: 3610,
      integralizada: 2100,
      pendente: 1510,
    });
  });

  it('carries equivalências and observações through as raw lines', () => {
    const { equivalencias, observacoes } = parseHistorico(itens);

    // Free-form text the screen may show verbatim; parsing them into structure
    // buys nothing today.
    expect(equivalencias).toHaveLength(1);
    expect(equivalencias[0]).toContain('através de');
    expect(observacoes.length).toBeGreaterThanOrEqual(3);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- historico.spec`
Expected: FAIL — `pendentesObrigatorios` has length 0.

- [ ] **Step 3: Write the implementation**

`modify: backend/src/sigaa-engine/parsers/historico.ts` — add above `parseHistorico`:

```ts
// "Componentes Curriculares Obrigatórios Pendentes:20" — the count is glued to
// the title, with no separating space.
const TITULO_PENDENTES_PATTERN = /Componentes Curriculares Obrigatórios Pendentes:(\d+)/;

const COLUNAS_PENDENTES = {
  codigo: [30, 110],
  nome: [110, 440],
  anotacao: [440, 500],
  cargaHoraria: [500, 580],
} as const;

/** "60 h" and "0h" both appear — the space is not reliable. */
function horas(bruto: string): number {
  const match = /(\d+)\s*h/i.exec(bruto);
  return match ? Number(match[1]) : 0;
}

function parsePendentes(itens: ItemTexto[]): ComponentePendente[] {
  const titulo = itens.find((i) => TITULO_PENDENTES_PATTERN.test(i.texto));
  if (!titulo) {
    // Not "nothing is pending" — an unread section. A transcript with nothing
    // left prints the title with ":0", so the anchor is there either way, and
    // returning [] here would let the count invariant satisfy itself with the
    // zero it derives from this same absent anchor.
    throw new Error(
      'Histórico não reconhecido: não achei a seção de componentes pendentes.',
    );
  }

  const daPagina = itens.filter((i) => i.pagina === titulo.pagina);
  const proximaSecao = daPagina
    .filter((i) => i.y < titulo.y && /^(Equival[êe]ncias|Observa[çc][õo]es)/.test(i.texto))
    .sort((a, b) => b.y - a.y)[0];

  const naSecao = daPagina.filter(
    (i) => i.y < titulo.y - 5 && i.y > (proximaSecao ? proximaSecao.y : 45),
  );

  // One row per distinct baseline. Grouping by y is enough here: unlike the
  // cursados table there is no second line per row.
  const linhas = [...new Set(naSecao.map((i) => Math.round(i.y * 2) / 2))].sort(
    (a, b) => b - a,
  );

  const pendentes: ComponentePendente[] = [];
  for (const y of linhas) {
    const codigo = celula(naSecao, COLUNAS_PENDENTES.codigo, y);
    const nome = celula(naSecao, COLUNAS_PENDENTES.nome, y);
    if (!codigo || !nome || /^C[óo]digo$/i.test(codigo)) {
      continue; // header row, or a stray footer line
    }
    pendentes.push({
      codigo,
      nome,
      cargaHoraria: horas(celula(naSecao, COLUNAS_PENDENTES.cargaHoraria, y)),
      matriculado: /matriculado/i.test(celula(naSecao, COLUNAS_PENDENTES.anotacao, y)),
    });
  }

  return pendentes;
}

const LINHAS_CARGA = ['Exigido', 'Integralizado', 'Pendente'] as const;

/**
 * The workload matrix: three rows (exigido/integralizado/pendente) by four
 * columns (obrigatórias/optativos/complementares/total). Read by row label,
 * then by x order — the four values of a row are the only items on its y.
 */
function parseCargaHoraria(itens: ItemTexto[]): Historico['cargaHoraria'] {
  const valores: Record<string, number[]> = {};

  for (const rotulo of LINHAS_CARGA) {
    const item = itens.find((i) => i.texto === rotulo || i.texto === `${rotulo}:`);
    if (!item) {
      throw new Error(
        `Histórico não reconhecido: não achei a linha "${rotulo}" do quadro de carga horária.`,
      );
    }
    valores[rotulo] = itens
      .filter(
        (i) =>
          i.pagina === item.pagina &&
          Math.abs(i.y - item.y) <= 1.5 &&
          i.x > item.x &&
          /\d+\s*h/i.test(i.texto),
      )
      .sort((a, b) => a.x - b.x)
      .map((i) => horas(i.texto));

    if (valores[rotulo].length !== 4) {
      throw new Error(
        `Histórico não reconhecido: a linha "${rotulo}" do quadro tem ` +
          `${valores[rotulo].length} valores, esperava 4.`,
      );
    }
  }

  const coluna = (indice: number): ResumoCargaHoraria => ({
    exigida: valores.Exigido[indice],
    integralizada: valores.Integralizado[indice],
    pendente: valores.Pendente[indice],
  });

  return {
    obrigatorias: coluna(0),
    optativas: coluna(1),
    complementares: coluna(2),
    total: coluna(3),
  };
}

/** Free-form lines under a section title, in reading order. */
function linhasDaSecao(itens: ItemTexto[], tituloPattern: RegExp): string[] {
  const titulo = itens.find((i) => tituloPattern.test(i.texto));
  if (!titulo) {
    return [];
  }
  const daPagina = itens.filter((i) => i.pagina === titulo.pagina);
  const proxima = daPagina
    .filter(
      (i) =>
        i.y < titulo.y - 5 &&
        /^(Equival[êe]ncias|Observa[çc][õo]es|Para verificar)/.test(i.texto),
    )
    .sort((a, b) => b.y - a.y)[0];

  const naSecao = daPagina.filter(
    (i) => i.y < titulo.y - 2 && i.y > (proxima ? proxima.y : 45),
  );

  const porLinha = new Map<number, ItemTexto[]>();
  for (const item of naSecao) {
    const chave = Math.round(item.y * 2) / 2;
    porLinha.set(chave, [...(porLinha.get(chave) ?? []), item]);
  }

  return [...porLinha.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, itensDaLinha]) =>
      itensDaLinha
        .sort((a, b) => a.x - b.x)
        .map((i) => i.texto)
        .join(' ')
        .replace(/^-\s*/, '')
        .trim(),
    )
    .filter((linha) => linha !== '');
}
```

Then in `parseHistorico`, replace the four placeholder values:

```ts
    pendentesObrigatorios: parsePendentes(itens),
    cargaHoraria: parseCargaHoraria(itens),
    equivalencias: linhasDaSecao(itens, /^Equival[êe]ncias/),
    observacoes: linhasDaSecao(itens, /^Observa[çc][õo]es/),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- historico.spec`
Expected: PASS, 16 tests.

The x-bands in `COLUNAS_PENDENTES` and the section-title regexes are the likely
failure points, since the spike documented the cursados bands precisely but not
these. If a test fails, dump the relevant page's items and adjust the bands:

```bash
cd backend && node -e "const i=require('./src/sigaa-engine/parsers/__fixtures__/historico-itens.json'); i.filter(x=>x.pagina===3).sort((a,b)=>b.y-a.y||a.x-b.x).forEach(x=>console.log(x.y.toFixed(1), x.x.toFixed(1), JSON.stringify(x.texto)))" | head -80
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/historico.ts \
  backend/src/sigaa-engine/parsers/historico.spec.ts
git commit -m "feat(backend): parse histórico pendentes, workload matrix and notes"
```

---

## Task 6: Validate the document's own invariants

**Files:**
- Modify: `backend/src/sigaa-engine/parsers/historico.ts`
- Modify: `backend/src/sigaa-engine/parsers/historico.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces: `parseHistorico` now throws on an internally inconsistent document. No signature change.

The transcript states enough to check itself. A parser that reads the wrong column still produces a plausible-looking object — these three checks are what turn that into a loud failure. The CR check is the strongest: it was how the spike confirmed the extraction reads the right cells at all.

- [ ] **Step 1: Write the failing test**

`modify: backend/src/sigaa-engine/parsers/historico.spec.ts` — add inside the existing `describe`:

```ts
  it('accepts the real document, whose invariants all hold', () => {
    expect(() => parseHistorico(itens)).not.toThrow();
  });

  it('refuses a document whose CR does not match its own component rows', () => {
    // Doctoring one grade breaks the recomputed CR. A parser reading the wrong
    // column would look exactly like this, which is what the check is for.
    const adulterado = itens.map((item) =>
      item.texto === '6.8' ? { ...item, texto: '9.9' } : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/CR/i);
  });

  it('refuses a document whose pending count contradicts its own title', () => {
    const adulterado = itens.map((item) =>
      TITULO_PENDENTES_TEXTO.test(item.texto)
        ? { ...item, texto: item.texto.replace(/:\d+$/, ':99') }
        : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/pendente/i);
  });
```

Add at the top of the spec file, after the imports:

```ts
const TITULO_PENDENTES_TEXTO = /Componentes Curriculares Obrigatórios Pendentes:\d+/;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- historico.spec`
Expected: FAIL — the two doctored documents parse without throwing.

- [ ] **Step 3: Write the implementation**

`modify: backend/src/sigaa-engine/parsers/historico.ts` — add above `parseHistorico`:

```ts
/**
 * Situações that grant integralised hours. Only APR appears in the fixture, but
 * the broader set is the semantically correct one — a transcript carrying a
 * dispensa must not be rejected by the workload check.
 */
const SITUACOES_INTEGRALIZADAS: readonly SituacaoComponente[] = [
  'APR', 'DISP', 'CUMP', 'INCORP', 'TRANS',
];

/**
 * The three things the document asserts about itself. A parser that read the
 * wrong column still yields a plausible object, so these are the difference
 * between a loud failure and silently wrong data on the student's screen.
 */
function validarInvariantes(historico: Historico, totalPendentesDeclarado: number): void {
  const integralizadaSomada = historico.cursados
    .filter((c) => SITUACOES_INTEGRALIZADAS.includes(c.situacao))
    .reduce((soma, c) => soma + c.cargaHoraria, 0);

  if (integralizadaSomada !== historico.cargaHoraria.total.integralizada) {
    throw new Error(
      'Histórico inconsistente: a carga horária somada dos componentes ' +
        `concluídos (${integralizadaSomada}h) não bate com a integralizada do ` +
        `quadro (${historico.cargaHoraria.total.integralizada}h).`,
    );
  }

  // Weighted by carga horária over rows carrying a grade. Trancados and
  // matriculados are out of both numerator and denominator — confirmed against
  // the real document, where this reproduces the printed CR exactly.
  const comNota = historico.cursados.filter((c) => c.nota !== null);
  const pesoTotal = comNota.reduce((soma, c) => soma + c.cargaHoraria, 0);

  if (historico.indices.cr !== null && pesoTotal > 0) {
    const crCalculado =
      comNota.reduce((soma, c) => soma + c.cargaHoraria * (c.nota as number), 0) /
      pesoTotal;

    if (Math.abs(crCalculado - historico.indices.cr) > 0.0001) {
      throw new Error(
        `Histórico inconsistente: o CR recalculado (${crCalculado.toFixed(4)}) ` +
          `não bate com o do documento (${historico.indices.cr}).`,
      );
    }
  }

  if (historico.pendentesObrigatorios.length !== totalPendentesDeclarado) {
    throw new Error(
      `Histórico inconsistente: li ${historico.pendentesObrigatorios.length} ` +
        `componentes pendentes, mas o título declara ${totalPendentesDeclarado}.`,
    );
  }
}
```

Then in `parseHistorico`, replace the `return { ... }` with a named object, validate, and return it:

```ts
  const historico: Historico = {
    /* ...exactly the object literal already there... */
  };

  const tituloPendentes = itens.find((i) => TITULO_PENDENTES_PATTERN.test(i.texto));
  const totalDeclarado = tituloPendentes
    ? Number(TITULO_PENDENTES_PATTERN.exec(tituloPendentes.texto)?.[1])
    : 0;

  validarInvariantes(historico, totalDeclarado);

  return historico;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- historico.spec`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/parsers/historico.ts \
  backend/src/sigaa-engine/parsers/historico.spec.ts
git commit -m "feat(backend): validate the histórico against its own invariants"
```

---

# Stage 2 — Persistence and endpoints

## Task 7: Schema and migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_historico/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: the Prisma models `Historico`, `HistoricoComponente`, `HistoricoPendente`, `PlanoItem`, and the `historico`/`planoItens` relations on `User`.

- [ ] **Step 1: Add the models**

`modify: backend/prisma/schema.prisma` — add these relation fields to `model User`:

```prisma
  historico       Historico?
  planoItens      PlanoItem[]
```

Then append:

```prisma
// Parsed snapshot of the student's Histórico Escolar PDF. Replaced wholesale on
// every sync: the PDF is the complete state, so upserting row by row would leave
// behind components an enrolment change removed.
model Historico {
  userId             String   @id @map("user_id")
  emitidoEm          DateTime @map("emitido_em")
  codigoVerificacao  String   @map("codigo_verificacao")
  curriculo          String
  periodoLetivoAtual Int      @map("periodo_letivo_atual")
  prazoPadrao        String   @map("prazo_padrao")
  prazoMaximo        String   @map("prazo_maximo")
  cr                 Decimal? @db.Decimal(6, 4)
  iap                Decimal? @db.Decimal(6, 4)

  // The workload matrix, flattened. `total` is derivable from the other three,
  // but persisting what the document asserts is what makes a future mismatch
  // detectable rather than invisible.
  chObrigatoriaExigida        Int @map("ch_obrigatoria_exigida")
  chObrigatoriaIntegralizada  Int @map("ch_obrigatoria_integralizada")
  chObrigatoriaPendente       Int @map("ch_obrigatoria_pendente")
  chOptativaExigida           Int @map("ch_optativa_exigida")
  chOptativaIntegralizada     Int @map("ch_optativa_integralizada")
  chOptativaPendente          Int @map("ch_optativa_pendente")
  chComplementarExigida       Int @map("ch_complementar_exigida")
  chComplementarIntegralizada Int @map("ch_complementar_integralizada")
  chComplementarPendente      Int @map("ch_complementar_pendente")
  chTotalExigida              Int @map("ch_total_exigida")
  chTotalIntegralizada        Int @map("ch_total_integralizada")
  chTotalPendente             Int @map("ch_total_pendente")

  equivalencias String[]
  observacoes   String[]

  fetchedAt DateTime @default(now()) @map("fetched_at")

  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  componentes HistoricoComponente[]
  pendentes   HistoricoPendente[]

  @@map("historico")
}

model HistoricoComponente {
  id           String   @id @default(uuid())
  historicoId  String   @map("historico_id")
  semestre     String
  // Null on trancamento rows: the transcript's natureza column emits nothing.
  natureza     String?
  codigo       String
  nome         String
  cargaHoraria Int      @map("carga_horaria")
  // Null when the document prints "--" (trancado, matriculado).
  nota         Decimal? @db.Decimal(3, 1)
  situacao     String
  docente      String?

  historico Historico @relation(fields: [historicoId], references: [userId], onDelete: Cascade)

  // The semestre belongs in the key: the same code legitimately recurs across
  // terms (trancado in one, reprovado or aprovado in the next).
  @@unique([historicoId, semestre, codigo])
  @@index([historicoId, semestre])
  @@map("historico_componente")
}

model HistoricoPendente {
  id           String  @id @default(uuid())
  historicoId  String  @map("historico_id")
  codigo       String
  nome         String
  cargaHoraria Int     @map("carga_horaria")
  matriculado  Boolean

  historico Historico @relation(fields: [historicoId], references: [userId], onDelete: Cascade)

  // nome is in the key because ENADE appears twice under different names.
  @@unique([historicoId, codigo, nome])
  @@map("historico_pendente")
}

// The student's own planning: which pending component they intend to take in
// which term. Authored data, not scraped — so unlike the three tables above it
// must survive a sync.
model PlanoItem {
  id           String  @id @default(uuid())
  userId       String  @map("user_id")
  codigo       String
  // Denormalised from the pending row so a plan item stays renderable across a
  // snapshot replacement — and so a future user-chosen optativa, which has no
  // pending row at all, can carry its own name and workload.
  nome         String
  cargaHoraria Int     @map("carga_horaria")
  // Null means the unplanned pool.
  semestre     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Deliberately NOT a foreign key onto HistoricoPendente: that relation would
  // cascade the student's planning away every time the snapshot is replaced.
  // HistoricoService.sync reconciles by codigo instead.
  @@unique([userId, codigo])
  @@map("plano_item")
}
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd backend && npx prisma migrate dev --name add_historico
```

Expected: a new directory under `prisma/migrations/`, and `prisma generate` runs.

- [ ] **Step 3: Verify the client typechecks**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(backend): add histórico snapshot and plano tables"
```

---

## Task 8: Repository

**Files:**
- Create: `backend/src/sigaa-engine/historico.repository.ts`
- Create: `backend/src/db/prisma-historico.repository.ts`
- Modify: `backend/src/db/tokens.ts`
- Modify: `backend/src/db/database.module.ts`

**Interfaces:**
- Consumes: `Historico` from Task 3; the Prisma models from Task 7.
- Produces:
  - `HISTORICO_REPOSITORY` symbol.
  - `interface ItemPlano { codigo: string; nome: string; cargaHoraria: number; semestre: string | null }`
  - `interface TrajetoriaSalva { historico: Historico; fetchedAt: Date; plano: ItemPlano[] }`
  - `interface HistoricoRepository { salvar(userId: string, historico: Historico): Promise<void>; buscar(userId: string): Promise<TrajetoriaSalva | null>; reconciliarPlano(userId: string, codigosPendentes: string[]): Promise<void> }`

Follows the token + factory pattern of the three existing repositories exactly.

- [ ] **Step 1: Write the interface**

`create: backend/src/sigaa-engine/historico.repository.ts`:

```ts
import type { Historico } from './parsers/historico';

export interface ItemPlano {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null means the unplanned pool. */
  semestre: string | null;
}

export interface TrajetoriaSalva {
  historico: Historico;
  fetchedAt: Date;
  plano: ItemPlano[];
}

export interface HistoricoRepository {
  /**
   * Replaces the user's whole snapshot in one transaction. The PDF is the
   * complete state, so a partial write would mix two documents' rows.
   */
  salvar(userId: string, historico: Historico): Promise<void>;

  /** Null when the user has never synced — the screen's fallback state. */
  buscar(userId: string): Promise<TrajetoriaSalva | null>;

  /**
   * Drops plan items whose component is no longer pending: it has been
   * completed. Called after `salvar`, since the plan is authored data that has
   * to outlive the snapshot it was built from.
   */
  reconciliarPlano(userId: string, codigosPendentes: string[]): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test**

`create: backend/src/db/prisma-historico.repository.spec.ts`:

```ts
import { PrismaHistoricoRepository } from './prisma-historico.repository';
import type { PrismaService } from './prisma.service';
import type { Historico } from '../sigaa-engine/parsers/historico';

function historicoMinimo(): Historico {
  return {
    emitidoEm: '2026-08-19',
    codigoVerificacao: 'aaaa1111bb',
    curriculo: 'G20251 - 2025.2',
    periodoLetivoAtual: 8,
    prazoConclusaoPadrao: '2030.1',
    prazoConclusaoMaximo: '2033.1',
    indices: { cr: 8.1597, iap: 0.8434 },
    cursados: [
      {
        semestre: '2023.1',
        natureza: 'OB',
        codigo: 'FISD36',
        nome: 'FÍSICA',
        cargaHoraria: 60,
        nota: 6.8,
        situacao: 'APR',
        docente: 'DR. ALGUEM (60h)',
      },
    ],
    pendentesObrigatorios: [
      { codigo: 'MATA59', nome: 'REDES', cargaHoraria: 60, matriculado: true },
    ],
    cargaHoraria: {
      obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
      optativas: { exigida: 360, integralizada: 0, pendente: 360 },
      complementares: { exigida: 100, integralizada: 0, pendente: 100 },
      total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
    },
    equivalencias: [],
    observacoes: [],
  };
}

describe('PrismaHistoricoRepository', () => {
  it('replaces the previous snapshot inside a single transaction', async () => {
    const operacoes: string[] = [];
    const tx = {
      historico: {
        deleteMany: jest.fn(async () => {
          operacoes.push('delete');
        }),
        create: jest.fn(async () => {
          operacoes.push('create');
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).salvar('user-1', historicoMinimo());

    // Delete before create, and both inside the same transaction callback:
    // otherwise a failure mid-write leaves two documents' rows mixed together.
    expect(operacoes).toEqual(['delete', 'create']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('drops only the plan items whose component is no longer pending', async () => {
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const prisma = { planoItem: { deleteMany } } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).reconciliarPlano('user-1', [
      'MATA59',
      'MATA60',
    ]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', codigo: { notIn: ['MATA59', 'MATA60'] } },
    });
  });

  it('reports null when the user has never synced', async () => {
    const prisma = {
      historico: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;

    const salva = await new PrismaHistoricoRepository(prisma).buscar('user-1');

    expect(salva).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- prisma-historico`
Expected: FAIL — cannot find module `./prisma-historico.repository`.

- [ ] **Step 4: Write the implementation**

`create: backend/src/db/prisma-historico.repository.ts`:

```ts
import type {
  HistoricoRepository,
  ItemPlano,
  TrajetoriaSalva,
} from '../sigaa-engine/historico.repository';
import type {
  Historico,
  NaturezaComponente,
  SituacaoComponente,
} from '../sigaa-engine/parsers/historico';
import { PrismaService } from './prisma.service';

export class PrismaHistoricoRepository implements HistoricoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async salvar(userId: string, historico: Historico): Promise<void> {
    const { cargaHoraria: ch } = historico;

    await this.prisma.$transaction(async (tx) => {
      // Componentes and pendentes cascade off historico, so one delete clears
      // the whole snapshot.
      await tx.historico.deleteMany({ where: { userId } });
      await tx.historico.create({
        data: {
          userId,
          emitidoEm: new Date(historico.emitidoEm),
          codigoVerificacao: historico.codigoVerificacao,
          curriculo: historico.curriculo,
          periodoLetivoAtual: historico.periodoLetivoAtual,
          prazoPadrao: historico.prazoConclusaoPadrao,
          prazoMaximo: historico.prazoConclusaoMaximo,
          cr: historico.indices.cr,
          iap: historico.indices.iap,
          chObrigatoriaExigida: ch.obrigatorias.exigida,
          chObrigatoriaIntegralizada: ch.obrigatorias.integralizada,
          chObrigatoriaPendente: ch.obrigatorias.pendente,
          chOptativaExigida: ch.optativas.exigida,
          chOptativaIntegralizada: ch.optativas.integralizada,
          chOptativaPendente: ch.optativas.pendente,
          chComplementarExigida: ch.complementares.exigida,
          chComplementarIntegralizada: ch.complementares.integralizada,
          chComplementarPendente: ch.complementares.pendente,
          chTotalExigida: ch.total.exigida,
          chTotalIntegralizada: ch.total.integralizada,
          chTotalPendente: ch.total.pendente,
          equivalencias: historico.equivalencias,
          observacoes: historico.observacoes,
          componentes: { create: historico.cursados },
          pendentes: { create: historico.pendentesObrigatorios },
        },
      });
    });
  }

  async buscar(userId: string): Promise<TrajetoriaSalva | null> {
    const registro = await this.prisma.historico.findUnique({
      where: { userId },
      include: {
        componentes: { orderBy: [{ semestre: 'asc' }, { codigo: 'asc' }] },
        pendentes: { orderBy: { codigo: 'asc' } },
      },
    });

    if (!registro) {
      return null;
    }

    const plano = await this.prisma.planoItem.findMany({
      where: { userId },
      orderBy: { codigo: 'asc' },
    });

    return {
      fetchedAt: registro.fetchedAt,
      plano: plano.map(
        (item): ItemPlano => ({
          codigo: item.codigo,
          nome: item.nome,
          cargaHoraria: item.cargaHoraria,
          semestre: item.semestre,
        }),
      ),
      historico: {
        emitidoEm: registro.emitidoEm.toISOString().slice(0, 10),
        codigoVerificacao: registro.codigoVerificacao,
        curriculo: registro.curriculo,
        periodoLetivoAtual: registro.periodoLetivoAtual,
        prazoConclusaoPadrao: registro.prazoPadrao,
        prazoConclusaoMaximo: registro.prazoMaximo,
        indices: {
          cr: registro.cr === null ? null : Number(registro.cr),
          iap: registro.iap === null ? null : Number(registro.iap),
        },
        cursados: registro.componentes.map((c) => ({
          semestre: c.semestre,
          natureza: c.natureza as NaturezaComponente | null,
          codigo: c.codigo,
          nome: c.nome,
          cargaHoraria: c.cargaHoraria,
          nota: c.nota === null ? null : Number(c.nota),
          situacao: c.situacao as SituacaoComponente,
          docente: c.docente,
        })),
        pendentesObrigatorios: registro.pendentes.map((p) => ({
          codigo: p.codigo,
          nome: p.nome,
          cargaHoraria: p.cargaHoraria,
          matriculado: p.matriculado,
        })),
        cargaHoraria: {
          obrigatorias: {
            exigida: registro.chObrigatoriaExigida,
            integralizada: registro.chObrigatoriaIntegralizada,
            pendente: registro.chObrigatoriaPendente,
          },
          optativas: {
            exigida: registro.chOptativaExigida,
            integralizada: registro.chOptativaIntegralizada,
            pendente: registro.chOptativaPendente,
          },
          complementares: {
            exigida: registro.chComplementarExigida,
            integralizada: registro.chComplementarIntegralizada,
            pendente: registro.chComplementarPendente,
          },
          total: {
            exigida: registro.chTotalExigida,
            integralizada: registro.chTotalIntegralizada,
            pendente: registro.chTotalPendente,
          },
        },
        equivalencias: registro.equivalencias,
        observacoes: registro.observacoes,
      },
    };
  }

  async reconciliarPlano(userId: string, codigosPendentes: string[]): Promise<void> {
    // A plan item whose component left the pending list has been completed.
    await this.prisma.planoItem.deleteMany({
      where: { userId, codigo: { notIn: codigosPendentes } },
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- prisma-historico`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire it into the module**

`modify: backend/src/db/tokens.ts` — append:

```ts
export const HISTORICO_REPOSITORY = Symbol('HISTORICO_REPOSITORY');
```

`modify: backend/src/db/database.module.ts` — add the import, a provider, and the export, matching the three existing entries:

```ts
    {
      provide: HISTORICO_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaHistoricoRepository(prisma),
    },
```

- [ ] **Step 7: Verify and commit**

```bash
cd backend && npx tsc --noEmit && npm test
```

Expected: typecheck clean, all tests pass.

```bash
git add backend/src/sigaa-engine/historico.repository.ts \
  backend/src/db/prisma-historico.repository.ts \
  backend/src/db/prisma-historico.repository.spec.ts \
  backend/src/db/tokens.ts backend/src/db/database.module.ts
git commit -m "feat(backend): persist the histórico snapshot and plano"
```

---

## Task 9: Service

**Files:**
- Create: `backend/src/sigaa-engine/historico.service.ts`
- Create: `backend/src/sigaa-engine/historico.service.spec.ts`

**Interfaces:**
- Consumes: `SigaaEngineService.fetchHistorico` (existing), `extrairItensHistorico` (Task 1), `parseHistorico` (Tasks 3–6), `HistoricoRepository` (Task 8).
- Produces: `class HistoricoService` with `sync(userId: string, credenciais: { login: string; senha: string }): Promise<TrajetoriaSalva>` and `getTrajetoria(userId: string): Promise<TrajetoriaSalva | null>`. Task 10 consumes both.

- [ ] **Step 1: Write the failing test**

`create: backend/src/sigaa-engine/historico.service.spec.ts`:

```ts
import { HistoricoService } from './historico.service';
import type { HistoricoRepository, TrajetoriaSalva } from './historico.repository';
import type { Historico } from './parsers/historico';

const CREDENCIAIS = { login: '209900011', senha: 'segredo' };

function historicoFalso(): Historico {
  return {
    emitidoEm: '2026-08-19',
    codigoVerificacao: 'aaaa1111bb',
    curriculo: 'G20251 - 2025.2',
    periodoLetivoAtual: 8,
    prazoConclusaoPadrao: '2030.1',
    prazoConclusaoMaximo: '2033.1',
    indices: { cr: 8.1597, iap: 0.8434 },
    cursados: [],
    pendentesObrigatorios: [
      { codigo: 'MATA59', nome: 'REDES', cargaHoraria: 60, matriculado: true },
      { codigo: 'MATA60', nome: 'BANCO DE DADOS', cargaHoraria: 60, matriculado: false },
    ],
    cargaHoraria: {
      obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
      optativas: { exigida: 360, integralizada: 0, pendente: 360 },
      complementares: { exigida: 100, integralizada: 0, pendente: 100 },
      total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
    },
    equivalencias: [],
    observacoes: [],
  };
}

function repositorioFalso(): jest.Mocked<HistoricoRepository> {
  return {
    salvar: jest.fn(async () => undefined),
    buscar: jest.fn(async () => null),
    reconciliarPlano: jest.fn(async () => undefined),
  };
}

describe('HistoricoService', () => {
  it('downloads, parses, persists and returns the trajectory in one call', async () => {
    const repositorio = repositorioFalso();
    const salva: TrajetoriaSalva = {
      historico: historicoFalso(),
      fetchedAt: new Date('2026-08-19T03:35:00Z'),
      plano: [],
    };
    repositorio.buscar.mockResolvedValue(salva);

    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );

    // Returning the aggregate saves the client a second round trip after a
    // wait long enough to need a progress indicator.
    await expect(service.sync('user-1', CREDENCIAIS)).resolves.toBe(salva);
    expect(repositorio.salvar).toHaveBeenCalledWith('user-1', expect.any(Object));
  });

  it('reconciles the plan against the freshly parsed pending list', async () => {
    const repositorio = repositorioFalso();
    repositorio.buscar.mockResolvedValue({
      historico: historicoFalso(),
      fetchedAt: new Date(),
      plano: [],
    });

    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );
    await service.sync('user-1', CREDENCIAIS);

    expect(repositorio.reconciliarPlano).toHaveBeenCalledWith('user-1', [
      'MATA59',
      'MATA60',
    ]);
  });

  it('persists nothing when the parser rejects the document', async () => {
    const repositorio = repositorioFalso();
    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => {
        throw new Error('Histórico inconsistente: o CR recalculado não bate');
      }),
      repositorio,
    );

    // The previous snapshot has to survive a bad parse — a student who synced
    // successfully last term must not lose their trajectory to a parser bug.
    await expect(service.sync('user-1', CREDENCIAIS)).rejects.toThrow(/CR/);
    expect(repositorio.salvar).not.toHaveBeenCalled();
    expect(repositorio.reconciliarPlano).not.toHaveBeenCalled();
  });

  it('reports null for a user who has never synced', async () => {
    const repositorio = repositorioFalso();
    const service = new HistoricoService(
      { fetchHistorico: jest.fn() },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );

    await expect(service.getTrajetoria('user-1')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- historico.service`
Expected: FAIL — cannot find module `./historico.service`.

- [ ] **Step 3: Write the implementation**

Extraction and parsing arrive as injected functions rather than direct imports, which is what lets the specs above drive every branch without a PDF.

`create: backend/src/sigaa-engine/historico.service.ts`:

```ts
import { Logger } from '@nestjs/common';
import type { HistoricoRepository, TrajetoriaSalva } from './historico.repository';
import type { Historico } from './parsers/historico';
import type { ItemTexto } from './parsers/historico-texto';

interface Credenciais {
  login: string;
  senha: string;
}

/** Just the slice of SigaaEngineService this service needs. */
interface DownloaderHistorico {
  fetchHistorico(credenciais: Credenciais): Promise<Buffer>;
}

type Extrator = (pdf: Buffer) => Promise<ItemTexto[]>;
type Parser = (itens: ItemTexto[]) => Historico;

export class HistoricoService {
  private readonly logger = new Logger(HistoricoService.name);

  constructor(
    private readonly downloader: DownloaderHistorico,
    private readonly extrair: Extrator,
    private readonly parse: Parser,
    private readonly repository: HistoricoRepository,
  ) {}

  /**
   * The whole sync, in order: download, extract, parse, persist, reconcile.
   *
   * Nothing is written before the parse succeeds. A parser that cannot make
   * sense of the document throws, and the student's previous snapshot survives
   * untouched — losing a working trajectory to a parser bug would be worse
   * than showing a stale one.
   */
  async sync(userId: string, credenciais: Credenciais): Promise<TrajetoriaSalva> {
    const pdf = await this.downloader.fetchHistorico(credenciais);
    const historico = this.parse(await this.extrair(pdf));

    await this.repository.salvar(userId, historico);
    await this.repository.reconciliarPlano(
      userId,
      historico.pendentesObrigatorios.map((p) => p.codigo),
    );

    this.logger.log(
      `Histórico sincronizado para ${userId}: ` +
        `${historico.cursados.length} componentes, ` +
        `${historico.pendentesObrigatorios.length} pendentes`,
    );

    const salva = await this.repository.buscar(userId);
    if (!salva) {
      throw new Error('Histórico salvo mas não encontrado logo depois.');
    }
    return salva;
  }

  /** Null means the user has never synced — the screen's fallback state. */
  async getTrajetoria(userId: string): Promise<TrajetoriaSalva | null> {
    return this.repository.buscar(userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- historico.service`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/historico.service.ts \
  backend/src/sigaa-engine/historico.service.spec.ts
git commit -m "feat(backend): orchestrate the histórico sync"
```

---

## Task 10: Controller and module wiring

**Files:**
- Create: `backend/src/sigaa-engine/trajetoria.controller.ts`
- Create: `backend/src/sigaa-engine/trajetoria.controller.spec.ts`
- Modify: `backend/src/sigaa-engine/sigaa-engine.module.ts`

**Interfaces:**
- Consumes: `HistoricoService` (Task 9), the existing `JwtAuthGuard`, `@CurrentUser()` and `SigaaCredentialsDto`.
- Produces: `POST /trajetoria/sync` and `GET /trajetoria`, both returning `TrajetoriaResponse = { historico: Historico; fetchedAt: string; plano: ItemPlano[] } | { sincronizado: false }`. Task 11 consumes this shape.

- [ ] **Step 1: Write the failing test**

`create: backend/src/sigaa-engine/trajetoria.controller.spec.ts`:

```ts
import { TrajetoriaController } from './trajetoria.controller';
import type { HistoricoService } from './historico.service';
import type { TrajetoriaSalva } from './historico.repository';

// All three fields: RequestUser requires `name` too, and these specs pass the
// object with no cast — matching sigaa.controller.spec.ts's convention.
const USUARIO = { userId: 'user-1', email: 'maria@example.com', name: 'Maria' };

function salvaFalsa(): TrajetoriaSalva {
  return {
    historico: { indices: { cr: 8.1597, iap: 0.8434 } } as TrajetoriaSalva['historico'],
    fetchedAt: new Date('2026-08-19T03:35:00Z'),
    plano: [],
  };
}

describe('TrajetoriaController', () => {
  it('reports the unsynced state instead of an error when nothing is stored', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => null),
      sync: jest.fn(),
    } as unknown as HistoricoService;

    // The screen's fallback state is a normal outcome, not a failure: a brand
    // new user has simply never pressed the sync button.
    await expect(new TrajetoriaController(service).get(USUARIO)).resolves.toEqual({
      sincronizado: false,
    });
  });

  it('serialises fetchedAt as an ISO string so the client can show staleness', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;

    const resposta = await new TrajetoriaController(service).get(USUARIO);

    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });

  it('returns the freshly synced aggregate, sparing the client a second call', async () => {
    const service = {
      getTrajetoria: jest.fn(),
      sync: jest.fn(async () => salvaFalsa()),
    } as unknown as HistoricoService;

    const resposta = await new TrajetoriaController(service).sync(USUARIO, {
      login: '209900011',
      senha: 'segredo',
    });

    expect(service.sync).toHaveBeenCalledWith('user-1', {
      login: '209900011',
      senha: 'segredo',
    });
    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- trajetoria.controller`
Expected: FAIL — cannot find module `./trajetoria.controller`.

- [ ] **Step 3: Write the implementation**

`create: backend/src/sigaa-engine/trajetoria.controller.ts`:

```ts
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { ItemPlano, TrajetoriaSalva } from './historico.repository';
import { HistoricoService } from './historico.service';
import type { Historico } from './parsers/historico';
import { SigaaCredentialsDto } from './sigaa-credentials.dto';

/**
 * `fetchedAt` is part of the payload on purpose. Once the eventual semester
 * cron lands it will only ever cover users on `syncMode: "cloud"` — the server
 * can never hold a device-mode credential — so the screen needs to be able to
 * say how old its data is, and the sync button stays permanent.
 */
export type TrajetoriaResponse =
  | { sincronizado: false }
  | { historico: Historico; fetchedAt: string; plano: ItemPlano[] };

function serializar(salva: TrajetoriaSalva): TrajetoriaResponse {
  return {
    historico: salva.historico,
    fetchedAt: salva.fetchedAt.toISOString(),
    plano: salva.plano,
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class TrajetoriaController {
  constructor(private readonly historicoService: HistoricoService) {}

  @Get('trajetoria')
  async get(@CurrentUser() user: RequestUser): Promise<TrajetoriaResponse> {
    const salva = await this.historicoService.getTrajetoria(user.userId);
    return salva ? serializar(salva) : { sincronizado: false };
  }

  // Credentials travel per-request in the body, same convention as /schedule:
  // a spec-compliant fetch client cannot send a body on a GET.
  @Post('trajetoria/sync')
  async sync(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<TrajetoriaResponse> {
    return serializar(
      await this.historicoService.sync(user.userId, {
        login: dto.login,
        senha: dto.senha,
      }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- trajetoria.controller`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the module**

`modify: backend/src/sigaa-engine/sigaa-engine.module.ts` — add `TrajetoriaController` to `controllers`, and add this provider, following the existing factory style:

```ts
    {
      provide: HistoricoService,
      inject: [SigaaEngineService, HISTORICO_REPOSITORY],
      useFactory: (
        engine: SigaaEngineService,
        repository: HistoricoRepository,
      ) =>
        new HistoricoService(
          engine,
          extrairItensHistorico,
          parseHistorico,
          repository,
        ),
    },
```

With the matching imports: `HISTORICO_REPOSITORY` from `../db/tokens`, `HistoricoRepository` from `./historico.repository`, `HistoricoService` from `./historico.service`, `extrairItensHistorico` from `./parsers/historico-texto`, `parseHistorico` from `./parsers/historico`, `TrajetoriaController` from `./trajetoria.controller`.

- [ ] **Step 6: Verify the whole backend and commit**

```bash
cd backend && npx tsc --noEmit && npm test
```

Expected: typecheck clean, every test passing.

```bash
git add backend/src/sigaa-engine/trajetoria.controller.ts \
  backend/src/sigaa-engine/trajetoria.controller.spec.ts \
  backend/src/sigaa-engine/sigaa-engine.module.ts
git commit -m "feat(backend): expose GET /trajetoria and POST /trajetoria/sync"
```

---

# Stage 3 — Mobile

## Task 11: API client

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/lib/api.test.ts`

**Interfaces:**
- Consumes: the `TrajetoriaResponse` shape from Task 10.
- Produces: the mobile types `ComponenteCursado`, `ComponentePendente`, `Historico`, `ItemPlano`, `TrajetoriaResponse`, plus `getTrajetoria(accessToken)` and `postTrajetoriaSync(accessToken, credentials)`. Tasks 12–13 consume these.

- [ ] **Step 1: Write the failing test**

`modify: mobile/src/lib/api.test.ts` — add a new `describe` block, matching the existing mock-fetch style in that file:

```ts
describe("trajetória endpoints", () => {
  // Same boilerplate every other block in this file has. Without it the URL is
  // unset by the time this block runs (the preceding block's afterEach restores
  // it to the unset value it had at load time), so `request()` throws before
  // reaching fetch — the first test would reject and the second would crash
  // reading `fetchMock.mock.calls[0]` on a fetch that never happened.
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:3000";
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it("reports the unsynced state without throwing", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ sincronizado: false }),
    })) as unknown as typeof fetch;

    await expect(getTrajetoria("token")).resolves.toEqual({ sincronizado: false });
  });

  it("gives the sync the long document timeout, not the default", async () => {
    // The sync makes ~7 sequential SIGAA requests server-side. The 10s default
    // aborts mid-scrape, and the fetch polyfill resolves that abort as an empty
    // response — which used to look like a successful-but-empty download.
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const promessa = postTrajetoriaSync("token", { login: "1", senha: "2" });
    const assertion = expect(promessa).rejects.toThrow();

    jest.advanceTimersByTime(20_000);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);

    jest.advanceTimersByTime(30_000);
    await assertion;
    jest.useRealTimers();
  });
});
```

Add `getTrajetoria` and `postTrajetoriaSync` to the file's existing import from `./api`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- api.test`
Expected: FAIL — `getTrajetoria` is not exported.

- [ ] **Step 3: Write the types**

`modify: mobile/src/lib/types.ts` — append:

```ts
/** Mirrors the backend's parser output — see backend/src/sigaa-engine/parsers/historico.ts. */
export interface ComponenteCursado {
  semestre: string;
  natureza: string | null;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null when the transcript printed "--": trancado or matriculado. */
  nota: number | null;
  situacao: string;
  docente: string | null;
}

export interface ComponentePendente {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  matriculado: boolean;
}

export interface ResumoCargaHoraria {
  exigida: number;
  integralizada: number;
  pendente: number;
}

export interface Historico {
  emitidoEm: string;
  codigoVerificacao: string;
  curriculo: string;
  periodoLetivoAtual: number;
  prazoConclusaoPadrao: string;
  prazoConclusaoMaximo: string;
  indices: { cr: number | null; iap: number | null };
  cursados: ComponenteCursado[];
  pendentesObrigatorios: ComponentePendente[];
  cargaHoraria: {
    obrigatorias: ResumoCargaHoraria;
    optativas: ResumoCargaHoraria;
    complementares: ResumoCargaHoraria;
    total: ResumoCargaHoraria;
  };
  equivalencias: string[];
  observacoes: string[];
}

export interface ItemPlano {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  semestre: string | null;
}

export type TrajetoriaResponse =
  | { sincronizado: false }
  | { historico: Historico; fetchedAt: string; plano: ItemPlano[] };
```

- [ ] **Step 4: Write the client functions**

`modify: mobile/src/lib/api.ts` — the existing `request()` helper hardcodes `REQUEST_TIMEOUT_MS`, so first give it an optional override. Change the `RequestOptions` interface and the timeout line:

```ts
interface RequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  accessToken?: string;
  /** Overrides the default timeout; the SIGAA scrape endpoints need far longer. */
  timeoutMs?: number;
}
```

```ts
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
```

Then append:

```ts
/** Reads the stored trajectory. Cheap — this hits our own database, not SIGAA. */
export async function getTrajetoria(accessToken: string): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria", { method: "GET", accessToken });
}

/**
 * Re-scrapes and re-parses the transcript server-side, then returns the fresh
 * aggregate — so the screen renders without a second round trip after a wait
 * long enough to need a progress indicator.
 *
 * This stays the primary path forever, not just until a background job exists:
 * a user on `syncMode: "device"` keeps their credential off our servers, so no
 * server-side job can ever refresh their trajectory.
 */
export async function postTrajetoriaSync(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria/sync", {
    method: "POST",
    accessToken,
    body: credentials,
    timeoutMs: SIGAA_DOCUMENT_TIMEOUT_MS,
  });
}
```

Add `TrajetoriaResponse` to the type import at the top of `api.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- api.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): add the trajetória API client"
```

---

## Task 12: Derivations

**Files:**
- Create: `mobile/src/lib/trajetoria.ts`
- Create: `mobile/src/lib/trajetoria.test.ts`
- Create: `mobile/src/lib/periodo-cache.ts`
- Create: `mobile/src/lib/periodo-cache.test.ts`

**Interfaces:**
- Consumes: `ComponenteCursado`, `ComponentePendente`, `ResumoCargaHoraria` from `./types`, and `parseIsoDate` from `./periodo-letivo`.
- Produces: `agruparPorSemestre`, `percentualConcluido`, `formatarNota`, `rotuloSituacao`, `poolPlanejavel`, `zonasDePlanejamento`, `historicoDesatualizado`, and the type `PeriodoTrajetoria`. Task 13 consumes all of them.

Everything the screen computes rather than reads, as pure functions — the reason the screen itself needs no logic tests beyond its states.

- [ ] **Step 1: Write the failing test**

`create: mobile/src/lib/trajetoria.test.ts`:

```ts
import {
  agruparPorSemestre,
  formatarCoeficiente,
  formatarNota,
  historicoDesatualizado,
  percentualConcluido,
  poolPlanejavel,
  rotuloSituacao,
  zonasDePlanejamento,
} from "./trajetoria";
import type { ComponenteCursado, ComponentePendente } from "./types";

function componente(over: Partial<ComponenteCursado> = {}): ComponenteCursado {
  return {
    semestre: "2025.1",
    natureza: "OB",
    codigo: "MATA37",
    nome: "INTRODUÇÃO À LÓGICA",
    cargaHoraria: 60,
    nota: 8.7,
    situacao: "APR",
    docente: null,
    ...over,
  };
}

describe("agruparPorSemestre", () => {
  it("groups components by term, oldest first", () => {
    const periodos = agruparPorSemestre([
      componente({ semestre: "2025.2", codigo: "MATA40" }),
      componente({ semestre: "2025.1", codigo: "MATA37" }),
    ]);

    expect(periodos.map((p) => p.semestre)).toEqual(["2025.1", "2025.2"]);
  });

  it("marks the term holding an enrolled component as the current one", () => {
    const periodos = agruparPorSemestre([
      componente({ semestre: "2025.1" }),
      componente({ semestre: "2026.2", situacao: "MATR", nota: null }),
    ]);

    expect(periodos.map((p) => p.emCurso)).toEqual([false, true]);
  });
});

describe("percentualConcluido", () => {
  it("divides integralised by required hours, both totals", () => {
    // Optativa and complementary hours are in the denominator: that is exactly
    // how those 360h "count" while no optativa is listed individually.
    expect(percentualConcluido({ exigida: 3610, integralizada: 2100, pendente: 1510 })).toBe(58);
  });

  it("reports zero rather than NaN when nothing is required yet", () => {
    expect(percentualConcluido({ exigida: 0, integralizada: 0, pendente: 0 })).toBe(0);
  });
});

describe("formatarNota", () => {
  it("renders the transcript's decimal point as a comma", () => {
    expect(formatarNota(8.7)).toBe("8,7");
    expect(formatarNota(10)).toBe("10,0");
  });

  it("renders a missing grade as an em dash", () => {
    expect(formatarNota(null)).toBe("—");
  });
});

describe("formatarCoeficiente", () => {
  it("keeps two decimals, not the grade formatter's one", () => {
    // The transcript prints the CR at four decimals (8.1597). One decimal
    // would round it to 8,2 and throw away a digit students compare against
    // their own arithmetic; four is noise on a summary card.
    expect(formatarCoeficiente(8.1597)).toBe("8,16");
    expect(formatarCoeficiente(10)).toBe("10,00");
  });

  it("renders an absent coefficient as an em dash", () => {
    expect(formatarCoeficiente(null)).toBe("—");
  });
});

describe("rotuloSituacao", () => {
  it("has no label for an approved component, which needs no chip", () => {
    expect(rotuloSituacao("APR")).toBeNull();
  });

  it("labels every situação that changes how a grade should be read", () => {
    expect(rotuloSituacao("REP")).toBe("reprovado");
    expect(rotuloSituacao("REPF")).toBe("reprovado por falta");
    expect(rotuloSituacao("TRANC")).toBe("trancado");
    expect(rotuloSituacao("MATR")).toBe("em curso");
    expect(rotuloSituacao("DISP")).toBe("dispensado");
  });

  it("falls back to the raw code for a situação the legend gained later", () => {
    expect(rotuloSituacao("XPTO")).toBe("XPTO");
  });
});

describe("poolPlanejavel", () => {
  const pendentes: ComponentePendente[] = [
    { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 60, matriculado: false },
    { codigo: "MATA59", nome: "REDES", cargaHoraria: 60, matriculado: true },
    { codigo: "ENADE", nome: "ENADE", cargaHoraria: 0, matriculado: false },
  ];

  it("drops components already being taken and the ENADE rows", () => {
    // ENADE is not a curricular component, and something already enrolled is
    // not something to plan.
    expect(poolPlanejavel(pendentes).map((p) => p.codigo)).toEqual(["MATA60"]);
  });
});

describe("zonasDePlanejamento", () => {
  it("offers the terms after the current one, bounded by the deadline", () => {
    // The transcript states the deadline; planning past it is not a plan.
    expect(zonasDePlanejamento("2026.2", "2027.2", 4)).toEqual([
      "2027.1",
      "2027.2",
    ]);
  });

  it("counts 2 to 1 across the year boundary", () => {
    expect(zonasDePlanejamento("2025.2", "2030.1", 3)).toEqual([
      "2026.1",
      "2026.2",
      "2027.1",
    ]);
  });

  it("returns nothing when the current term is already the deadline", () => {
    expect(zonasDePlanejamento("2030.1", "2030.1", 4)).toEqual([]);
  });
});

describe("historicoDesatualizado", () => {
  const fim = "2026-07-15";
  const emCurso = [componente({ semestre: "2026.1", situacao: "MATR", nota: null })];
  const consolidado = [componente({ semestre: "2026.1", situacao: "APR", nota: 7 })];

  it("flags a term that has ended while components are still in progress", () => {
    // Both conditions together: grades that have yet to land (MATR), and a term
    // already over, so they should have landed by now.
    expect(historicoDesatualizado(emCurso, fim, new Date("2026-08-19"))).toBe(true);
  });

  it("stays quiet while the term is still running", () => {
    // MATR is true all semester. On its own it is a permanent banner, and a
    // permanent banner is one the student stops seeing.
    expect(historicoDesatualizado(emCurso, fim, new Date("2026-07-01"))).toBe(false);
  });

  it("stays quiet once every component is consolidated", () => {
    expect(historicoDesatualizado(consolidado, fim, new Date("2026-08-19"))).toBe(false);
  });

  it("stays quiet when the term's end date is unknown", () => {
    // No cached date, or a portal that reported a term without one: say nothing
    // rather than guess.
    expect(historicoDesatualizado(emCurso, null, new Date("2026-08-19"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- trajetoria.test.ts`
Expected: FAIL — cannot find module `./trajetoria`.

- [ ] **Step 3: Write the implementation**

`create: mobile/src/lib/trajetoria.ts`:

```ts
import { parseIsoDate } from "./periodo-letivo";
import type { ComponenteCursado, ComponentePendente, ResumoCargaHoraria } from "./types";

export interface PeriodoTrajetoria {
  semestre: string;
  emCurso: boolean;
  componentes: ComponenteCursado[];
}

/** Enrolled — the transcript's marker for the term that hasn't closed yet. */
const SITUACAO_MATRICULADO = "MATR";

/** Not a curricular component; it shows up among the pending rows anyway. */
const CODIGO_ENADE = "ENADE";

const ROTULOS_SITUACAO: Record<string, string> = {
  REP: "reprovado",
  REPF: "reprovado por falta",
  REPMF: "reprovado por média e falta",
  TRANC: "trancado",
  CANC: "cancelado",
  DISP: "dispensado",
  MATR: "em curso",
  TRANS: "transferido",
  INCORP: "incorporado",
  CUMP: "cumprido",
};

export function agruparPorSemestre(cursados: ComponenteCursado[]): PeriodoTrajetoria[] {
  const porSemestre = new Map<string, ComponenteCursado[]>();
  for (const componente of cursados) {
    porSemestre.set(componente.semestre, [
      ...(porSemestre.get(componente.semestre) ?? []),
      componente,
    ]);
  }

  return [...porSemestre.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semestre, componentes]) => ({
      semestre,
      // A term holding an enrolled component is the one still running. Cheaper
      // and more reliable than comparing dates, and it matches what the
      // transcript itself asserts via periodoLetivoAtual.
      emCurso: componentes.some((c) => c.situacao === SITUACAO_MATRICULADO),
      componentes,
    }));
}

export function percentualConcluido(total: ResumoCargaHoraria): number {
  if (total.exigida === 0) {
    return 0;
  }
  return Math.round((total.integralizada / total.exigida) * 100);
}

/** The transcript uses a decimal point; the comma is ours, applied at render. */
export function formatarNota(nota: number | null): string {
  return nota === null ? "—" : nota.toFixed(1).replace(".", ",");
}

/**
 * The CR on the summary card. Two decimals, not the one `formatarNota` gives a
 * grade: the transcript prints the coefficient at four (8.1597), and rounding
 * it to 8,2 discards a digit students check against their own arithmetic.
 */
export function formatarCoeficiente(valor: number | null): string {
  return valor === null ? "—" : valor.toFixed(2).replace(".", ",");
}

/**
 * The chip next to a grade. Null for APR, which needs none — every other
 * situação changes how the number beside it should be read, and a 4,0 that was
 * failed must not look identical to a 4,0 that was passed.
 */
export function rotuloSituacao(situacao: string): string | null {
  if (situacao === "APR") {
    return null;
  }
  // An unmapped code means SIGAA's legend grew: show it raw rather than hide it.
  return ROTULOS_SITUACAO[situacao] ?? situacao;
}

/** What the planner may offer: pending, not already enrolled, actually curricular. */
export function poolPlanejavel(pendentes: ComponentePendente[]): ComponentePendente[] {
  return pendentes.filter((p) => !p.matriculado && p.codigo !== CODIGO_ENADE);
}

/**
 * The terms the planner offers as drop zones: the ones after the current term,
 * capped at `limite` and never past the conclusion deadline the transcript
 * states. SIGAA terms run `.1` then `.2` within a year.
 */
export function zonasDePlanejamento(
  semestreAtual: string,
  prazoMaximo: string,
  limite: number,
): string[] {
  const proximo = (semestre: string): string => {
    const [ano, periodo] = semestre.split(".").map(Number);
    return periodo === 1 ? `${ano}.2` : `${ano + 1}.1`;
  };

  const zonas: string[] = [];
  let atual = proximo(semestreAtual);
  while (zonas.length < limite && atual.localeCompare(prazoMaximo) <= 0) {
    zonas.push(atual);
    atual = proximo(atual);
  }
  return zonas;
}

/**
 * Whether to nudge the student to re-sync: the transcript still shows
 * components in progress, and the term they belong to is already over.
 *
 * Both conditions are necessary. `MATR` on its own holds all semester long, so
 * it would render a permanent banner — and a permanent banner is one the
 * student stops seeing. The end date is what turns it into a signal.
 *
 * Derived entirely on the device. A user on `syncMode: "device"` keeps their
 * credential off our servers, so no background job will ever refresh them —
 * without this they would have no signal at all that grades have landed.
 *
 * `fimDoPeriodo` comes from the device-local cache the home screen writes (see
 * periodo-cache.ts), not from a request of this screen's own.
 */
export function historicoDesatualizado(
  cursados: ComponenteCursado[],
  fimDoPeriodo: string | null,
  agora: Date,
): boolean {
  if (!fimDoPeriodo) {
    return false;
  }
  // MATR rows are the grades that have yet to land. Without one there is
  // nothing to wait for, however old the transcript is.
  if (!cursados.some((c) => c.situacao === SITUACAO_MATRICULADO)) {
    return false;
  }
  // parseIsoDate, never `new Date(string)`: the latter reads a bare YYYY-MM-DD
  // as UTC midnight, which lands on the previous day in Brazil. types.ts
  // documents this trap on PeriodoLetivo, and periodo-letivo.ts exists to avoid
  // it. The tests here would not catch the difference — both sides of their
  // comparisons are built the same way — but a real `fetchedAt` carries a real
  // time of day and would not cancel out.
  const fim = parseIsoDate(fimDoPeriodo);
  return agora > fim;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- trajetoria.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Write the failing test for the term-date cache**

`historicoDesatualizado` needs the term's end date, and the Trajetória screen has
no request that carries one. The home screen already fetches it on every open, so
the date is cached on the device rather than re-fetched. `expo-secure-store` is
the app's only persistence mechanism — overkill for a public date, but it is what
`session-storage.ts` and `sigaa-storage.ts` both use, and adding a dependency for
this would be worse.

`create: mobile/src/lib/periodo-cache.test.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import { getPeriodoCache, savePeriodoCache } from "./periodo-cache";

jest.mock("expo-secure-store");

describe("periodo-cache", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("round-trips the term through the store", async () => {
    const periodo = { semestre: "2026.1", inicio: "2026-03-02", fim: "2026-07-15" };
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(periodo));

    await savePeriodoCache(periodo);

    await expect(getPeriodoCache()).resolves.toEqual(periodo);
  });

  it("reports null when nothing was ever cached", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("reports null instead of throwing on corrupted contents", async () => {
    // Same defensive shape as sigaa-storage.ts: a bad read must degrade to "no
    // cached date", which makes the nudge stay quiet rather than crash a screen.
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("{ not json");

    await expect(getPeriodoCache()).resolves.toBeNull();
  });

  it("ignores a stored value missing the field the caller needs", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({ semestre: "2026.1" }));

    await expect(getPeriodoCache()).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- periodo-cache`
Expected: FAIL — cannot find module `./periodo-cache`.

- [ ] **Step 7: Write the cache**

`create: mobile/src/lib/periodo-cache.ts`:

```ts
import * as SecureStore from "expo-secure-store";

import type { PeriodoLetivo } from "./types";

/**
 * Last academic term the app saw, kept so screens that never call `/schedule`
 * can still tell whether the term is over.
 *
 * Written by the home screen after a successful schedule fetch, read by the
 * Trajetória screen to decide whether to nudge a re-sync. Not secret — it lives
 * in SecureStore only because that is the app's one persistence mechanism.
 */
const PERIODO_KEY = "gradline.periodo";

function isPeriodoLetivo(value: unknown): value is PeriodoLetivo {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PeriodoLetivo).semestre === "string" &&
    typeof (value as PeriodoLetivo).inicio === "string" &&
    typeof (value as PeriodoLetivo).fim === "string"
  );
}

export async function getPeriodoCache(): Promise<PeriodoLetivo | null> {
  try {
    const raw = await SecureStore.getItemAsync(PERIODO_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isPeriodoLetivo(parsed) ? parsed : null;
  } catch {
    // A bad read degrades to "no cached date", which keeps the nudge quiet.
    // Never let a cache miss take a screen down.
    return null;
  }
}

export async function savePeriodoCache(periodo: PeriodoLetivo): Promise<void> {
  await SecureStore.setItemAsync(PERIODO_KEY, JSON.stringify(periodo));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mobile && npm test -- periodo-cache`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/lib/trajetoria.ts mobile/src/lib/trajetoria.test.ts \
  mobile/src/lib/periodo-cache.ts mobile/src/lib/periodo-cache.test.ts
git commit -m "feat(mobile): add trajetória derivations and the term-date cache"
```

---

## Task 13: The screen

**Files:**
- Modify: `mobile/src/app/(tabs)/trajetoria.tsx`
- Create: `mobile/src/__tests__/trajetoria.test.tsx`
- Modify: `mobile/src/lib/mock-data.ts`
- Create: `mobile/src/components/DownloadProgressBar.tsx`
- Modify: `mobile/src/app/(tabs)/documentos.tsx` (import the extracted component instead of its local copy)
- Modify: `mobile/src/app/(tabs)/index.tsx` (write the term to the cache after a successful schedule fetch)

**Interfaces:**
- Consumes: everything from Tasks 11 and 12.
- Produces: the finished screen. Nothing depends on it.

The screen's existing layout — summary card, progress bar, per-period sections, planner zones with the move-to menu — stays. What changes is where the data comes from, plus the load states and the situação chip.

Follow the load-state pattern already in `app/(tabs)/index.tsx`: a `LoadState` union, a `useCallback` loader that reads credentials from `getSigaaCredentials()`, a `useEffect` keyed on `sigaaLink.status` and `accessToken`, and `RefreshControl` wired to a silent reload.

**Note on tests:** per the project's own convention, render asynchronously and, when advancing timers, use an async `act` and drain pending work before `useRealTimers` — see the existing `home.test.tsx`.

- [ ] **Step 1: Write the failing test**

`create: mobile/src/__tests__/trajetoria.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TrajetoriaTab from "@/app/(tabs)/trajetoria";
import { getTrajetoria, postTrajetoriaSync } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/sigaa-link-context");
jest.mock("@/lib/sigaa-storage");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getTrajetoria: jest.fn(),
  postTrajetoriaSync: jest.fn(),
}));

// heroui-native has to be mocked by hand — see home.test.tsx, which does the
// same for the components the home screen uses. This screen needs Typography,
// Menu, Button and useThemeColor.
jest.mock("heroui-native", () => {
  const { Text, View, TouchableOpacity } = jest.requireActual("react-native");

  const Menu = Object.assign(({ children }: any) => <View>{children}</View>, {
    Trigger: ({ children }: any) => <View>{children}</View>,
    Portal: ({ children }: any) => <View>{children}</View>,
    Overlay: () => null,
    Content: ({ children }: any) => <View>{children}</View>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    Item: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>{children}</TouchableOpacity>
    ),
    ItemTitle: ({ children }: any) => <Text>{children}</Text>,
  });

  return {
    Menu,
    Button: ({ children, onPress }: any) => (
      <TouchableOpacity onPress={onPress}>
        <Text>{children}</Text>
      </TouchableOpacity>
    ),
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

beforeEach(() => {
  // `status` is load-bearing, not decoration: useAuth returns a discriminated
  // union and the screen reads accessToken only on the "signedIn" variant, so
  // omitting it leaves accessToken null and the screen stuck loading forever.
  // Same shape home.test.tsx uses.
  jest.mocked(useAuth).mockReturnValue({
    status: "signedIn",
    accessToken: "token",
    user: { id: "user-1", email: "maria@example.com", name: "Maria" },
  } as ReturnType<typeof useAuth>);
  jest.mocked(useSigaaLink).mockReturnValue({ status: "linked" } as ReturnType<
    typeof useSigaaLink
  >);
  jest.mocked(getSigaaCredentials).mockResolvedValue({
    login: "209900011",
    senha: "segredo",
    syncMode: "device",
  });
});

describe("Trajetória", () => {
  it("offers to sync when the user has never synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    render(<TrajetoriaTab />);

    expect(await screen.findByText(/sincronizar histórico/i)).toBeTruthy();
    // The mock data must be gone: no invented coefficient on an empty state.
    expect(screen.queryByText("7,84")).toBeNull();
  });

  it("discloses what is kept and what is discarded before the first sync", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });

    render(<TrajetoriaTab />);

    // Both halves, not just the reassuring one: grades ARE stored, and a
    // disclosure that only said "nothing sensitive is kept" would be false by
    // omission. This is the user-facing end of the same requirement Task 3
    // asserts from the parser's end.
    expect(await screen.findByText(/O que fica guardado/i)).toBeTruthy();
    expect(screen.getByText(/matérias, notas e carga horária/i)).toBeTruthy();
    expect(screen.getByText(/O que não fica/i)).toBeTruthy();
    expect(screen.getByText(/CPF, RG e data de nascimento/i)).toBeTruthy();
  });

  it("shows the coefficient and progress once synced", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({
      fetchedAt: "2026-08-19T03:35:00.000Z",
      plano: [],
      historico: {
        indices: { cr: 8.1597, iap: 0.8434 },
        cursados: [],
        pendentesObrigatorios: [],
        cargaHoraria: {
          obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
          optativas: { exigida: 360, integralizada: 0, pendente: 360 },
          complementares: { exigida: 100, integralizada: 0, pendente: 100 },
          total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
        },
        equivalencias: [],
        observacoes: [],
      },
    } as Awaited<ReturnType<typeof getTrajetoria>>);

    render(<TrajetoriaTab />);

    expect(await screen.findByText("8,16")).toBeTruthy();
    expect(screen.getByText(/58% do curso/i)).toBeTruthy();
  });

  it("distinguishes a failed grade from an identical passing one", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({
      fetchedAt: "2026-08-19T03:35:00.000Z",
      plano: [],
      historico: {
        indices: { cr: null, iap: null },
        cursados: [
          {
            semestre: "2024.2",
            natureza: "OB",
            codigo: "MATA97",
            nome: "MATEMÁTICA DISCRETA II",
            cargaHoraria: 60,
            nota: 4,
            situacao: "REP",
            docente: null,
          },
        ],
        pendentesObrigatorios: [],
        cargaHoraria: {
          obrigatorias: { exigida: 0, integralizada: 0, pendente: 0 },
          optativas: { exigida: 0, integralizada: 0, pendente: 0 },
          complementares: { exigida: 0, integralizada: 0, pendente: 0 },
          total: { exigida: 0, integralizada: 0, pendente: 0 },
        },
        equivalencias: [],
        observacoes: [],
      },
    } as Awaited<ReturnType<typeof getTrajetoria>>);

    render(<TrajetoriaTab />);

    expect(await screen.findByText("4,0")).toBeTruthy();
    expect(screen.getByText("reprovado")).toBeTruthy();
  });

  it("surfaces a sync failure without wiping what is already on screen", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue({ sincronizado: false });
    jest.mocked(postTrajetoriaSync).mockRejectedValue(new Error("SIGAA fora do ar"));

    render(<TrajetoriaTab />);
    fireEvent.press(await screen.findByText(/sincronizar histórico/i));

    await waitFor(() => {
      expect(screen.getByText(/não deu para sincronizar/i)).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- trajetoria.test.tsx`
Expected: FAIL — the screen still renders mock data and has no sync affordance.

- [ ] **Step 2b: Have the home screen fill the term cache**

`modify: mobile/src/app/(tabs)/index.tsx` — inside `loadSchedule`, right after
`postSchedule` resolves and before `setState`, persist the term when the response
carried one:

```tsx
        if (periodoLetivo) {
          // Cached for screens that never call /schedule — Trajetória reads this
          // to tell whether the term is over. Fire and forget: a failed write
          // must not turn a good schedule fetch into an error.
          void savePeriodoCache(periodoLetivo).catch((error: unknown) => {
            console.warn("Failed to cache the academic term", error);
          });
        }
```

Import `savePeriodoCache` from `@/lib/periodo-cache`. The existing
`home.test.tsx` must keep passing untouched — run
`cd mobile && npm test -- home.test` to confirm. It mocks `@/lib/api` but not
`expo-secure-store`, so if the write surfaces there, mock `@/lib/periodo-cache`
in that suite rather than changing the screen.

- [ ] **Step 3: Extract the shared progress bar**

`DownloadProgressBar` already exists as a local component inside
`mobile/src/app/(tabs)/documentos.tsx` (its `function DownloadProgressBar({ stages })`,
plus the `useState`/`useEffect` that tick `downloadProgress(elapsedMs, stages)`). Two
screens now need it, so move it rather than copy it:

1. Create `mobile/src/components/DownloadProgressBar.tsx` holding that component
   verbatim — same props, same interval, same JSX. Export it as a named export,
   matching the other files in `mobile/src/components/`.
2. Delete the local copy from `documentos.tsx` and import the extracted one. Its
   `downloadProgress` / `ProgressStage` imports go away with it; `HISTORICO_STAGES`
   and `ATESTADO_STAGES` stay, since `documentos.tsx` still picks between them.
3. Run `cd mobile && npm test -- documentos.test` — it must still pass untouched.
   That suite is the proof the move changed no behaviour.

- [ ] **Step 3b: Rewrite the screen**

`modify: mobile/src/app/(tabs)/trajetoria.tsx`:

- Replace the `mock-data` import with `getTrajetoria` / `postTrajetoriaSync` from `@/lib/api`, `getSigaaCredentials` from `@/lib/sigaa-storage`, and the derivations from `@/lib/trajetoria`.
- Add the load state:

```tsx
type LoadState =
  | { status: "loading" }
  | { status: "unsynced" }
  | { status: "error"; message: string }
  | { status: "ready"; historico: Historico; fetchedAt: Date; plano: ItemPlano[] };
```

- Summary card: `formatarCoeficiente(historico.indices.cr)` for the coefficient — the CR, not the IAP (a 0–1 index this screen does not show), and `formatarCoeficiente` rather than `formatarNota`, which rounds to the one decimal a grade wants, `cargaHoraria.total.integralizada` / `.exigida` for the hours, `percentualConcluido(cargaHoraria.total)` for the bar width and its caption, and `poolPlanejavel(pendentesObrigatorios).length` for "faltam N matérias".
- Periods: `agruparPorSemestre(historico.cursados)`, with `emCurso` driving the existing `tone === "now"` styling and the "Em curso" / "Concluído" badge.
- Each component row keeps its name, code and `formatarNota(nota)` coloured by the existing `gradeColor`. The situação chip is the one genuinely new piece of UI — it reuses the badge styling already in the period header:

```tsx
{(() => {
  const rotulo = rotuloSituacao(componente.situacao);
  return rotulo ? (
    <View className="rounded-full bg-white/5 px-2 py-1">
      <Typography.Paragraph type="body-xs" color="muted">
        {rotulo}
      </Typography.Paragraph>
    </View>
  ) : null;
})()}
```

- Planner zones: keep the existing `Menu`-based move-to interaction, with the zone labels from `zonasDePlanejamento(semestreAtual, historico.prazoConclusaoMaximo, 2)` plus the unplanned pool, and the courses from `poolPlanejavel(historico.pendentesObrigatorios)`. `semestreAtual` is the `semestre` of the period `agruparPorSemestre` marked `emCurso`. Persisting a move is **not** in this task — the zones stay local state, exactly as they are today.
- Below the summary card, the freshness line. `fimDoPeriodo` is state the screen
  loads once from the cache — `const [fimDoPeriodo, setFimDoPeriodo] = useState<string | null>(null)`,
  filled by a `useEffect` that calls `getPeriodoCache()` and sets
  `periodo?.fim ?? null`. No request: the home screen is what populates that cache.

```tsx
<Typography.Paragraph type="body-xs" color="muted">
  {historicoDesatualizado(historico.cursados, fimDoPeriodo, new Date())
    ? "O semestre acabou e seu histórico ainda tem matérias em curso — sincronize para ver as notas."
    : `Sincronizado em ${fetchedAt.toLocaleDateString("pt-BR")}`}
</Typography.Paragraph>
```

  The five tests in Step 1 mock `@/lib/periodo-cache` alongside `@/lib/api`; with
  `getPeriodoCache` resolving `null` the nudge stays quiet, which is what the four
  non-staleness tests expect. Add a sixth test that resolves a term already ended
  against a fixture carrying a `MATR` row, and asserts the nudge text appears.

- Fallback state, for a user who has never synced. The disclosure sits **above** the button, not below it: pressing sync is the moment the user hands us a document carrying their CPF, RG and date of birth, so what we keep and what we discard has to be readable before the press, not after.

  Note the copy names both sides. A bare "não guardamos nada sensível" would be false by omission — grades and workload *are* stored, which is the entire point of the screen.

  Keep it in the student's vocabulary. "Descartados na leitura" is deliberate; an earlier draft said "nunca chegam ao banco", which is accurate and means nothing to a reader who does not picture their data as living in a database.

```tsx
<View className="rounded-3xl bg-surface-secondary p-5 gap-3">
  <Typography.Heading type="h6">Sua trajetória ainda não foi montada</Typography.Heading>
  <Typography.Paragraph type="body-sm" color="muted">
    Vamos buscar seu histórico escolar no SIGAA e montar sua trajetória. Leva
    alguns segundos.
  </Typography.Paragraph>

  <View className="rounded-2xl bg-white/[0.04] p-3.5 gap-1.5">
    <Typography.Paragraph type="body-xs" color="muted">
      <Typography.Paragraph type="body-xs" weight="medium">
        O que fica guardado:{" "}
      </Typography.Paragraph>
      suas matérias, notas e carga horária — é o que monta esta tela.
    </Typography.Paragraph>
    <Typography.Paragraph type="body-xs" color="muted">
      <Typography.Paragraph type="body-xs" weight="medium">
        O que não fica:{" "}
      </Typography.Paragraph>
      CPF, RG e data de nascimento. Eles estão no documento, mas são
      descartados na leitura.
    </Typography.Paragraph>
  </View>

  <Button onPress={sincronizar} isDisabled={sincronizando}>
    {sincronizando ? "Sincronizando…" : "Sincronizar histórico"}
  </Button>

  {/* The wait is ~40s of server-side scraping. A disabled button with a
      changed label is not enough feedback for that long, and the calibrated
      stage model for exactly this request already exists. */}
  {sincronizando ? <DownloadProgressBar stages={HISTORICO_STAGES} /> : null}
</View>
```

Imports for the block above: `DownloadProgressBar` from `@/components/DownloadProgressBar` and `HISTORICO_STAGES` from `@/lib/download-progress`.

- Error copy: "Não deu para sincronizar seu histórico." plus `describeApiError(error)` from `@/lib/api-errors`, the helper the home screen already uses.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- trajetoria.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Drop the now-unused mocks**

`modify: mobile/src/lib/mock-data.ts` — remove `TRANSCRIPT_SUMMARY`, `PERIODS`, `Period`, `CompletedCourseRow`, `PENDING_COURSES`, `PendingCourseId`, `PLAN_ZONES`, `PlanZoneKey` and `INITIAL_PLAN`. All nine are now derived from real data — the zone labels come from `zonasDePlanejamento`. Keep `gradeColor`, `DOCUMENT_DEFS`, `DocumentKey` and everything else other screens still import.

Then confirm nothing dangles:

```bash
cd mobile && npm run typecheck && npm run lint && npm test
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/\(tabs\)/trajetoria.tsx \
  mobile/src/__tests__/trajetoria.test.tsx mobile/src/lib/mock-data.ts
git commit -m "feat(mobile): drive the trajetória screen from real transcript data"
```

---

# Verification

After Task 13, from a clean tree:

```bash
cd backend && npx tsc --noEmit && npm test
```

```bash
cd mobile && npm run typecheck && npm run lint && npm test
```

Then the end-to-end check the parsers cannot cover, since `fetchHistorico` has
never been validated against the real SIGAA (see
`HISTORICO_PDF_INVESTIGATION.md`): run the app against a real account, press
**Sincronizar histórico**, and confirm the coefficient on screen matches the CR
printed on the transcript PDF. If the sync fails, the failure is in
`fetchHistorico`, not in anything this plan builds — the parsers are already
verified against the real document by their fixture.
