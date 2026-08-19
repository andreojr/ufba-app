/**
 * One-off: turn a real transcript PDF into the anonymised fixture the parser
 * specs read. Not part of the application.
 *
 * Usage: npx ts-node scripts/dump-historico-fixture.ts <caminho-do-pdf>
 *
 * This file is committed, so it contains no personal value of any kind. It
 * locates them instead: each sensitive field is a label with its value painted
 * at the same y, to the right — so the script reads the value beside the label,
 * then replaces every occurrence of that string across the whole dump. That
 * global pass is what catches the repeats (the matrícula reappears in the
 * page-2/3 continuation header and in the footer).
 *
 * Coordinates are never touched. The parser reads cells off x/y bands, so a
 * replacement of a different length is harmless — which is exactly why this
 * approach is safe for the fixture's purpose.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extrairItensHistorico,
  type ItemTexto,
} from '../src/sigaa-engine/parsers/historico-texto';

/**
 * Sensitive labels, each paired with the fictional value that replaces whatever
 * sits beside it. The left side is a label printed on every transcript; the
 * right side is invented. Neither is personal data.
 */
const CAMPOS_SENSIVEIS: { rotulo: string; ficticio: string }[] = [
  { rotulo: 'Nome:', ficticio: 'MARIA DA SILVA SANTOS' },
  { rotulo: 'Matrícula:', ficticio: '209900011' },
  { rotulo: 'Data de Nascimento:', ficticio: '15/03/2001' },
  { rotulo: 'Local de Nascimento:', ficticio: 'CIDADE FICTICIA/BA' },
  { rotulo: 'Nº do CPF:', ficticio: '111.222.333-44' },
  { rotulo: 'Nº do documento com órgão expedidor:', ficticio: '9999999999, (SSP/BA)' },
];

/**
 * The footer's authenticity code, found by its shape rather than by its label:
 * ten lowercase alphanumerics carrying at least one digit and at least one
 * letter.
 *
 * Three earlier versions anchored on the phrase "código de verificação:" and all
 * three failed on geometry — the phrase is split across text runs, then across
 * two physical lines, then across a right-margin stamp painted at a y between
 * those lines. Each fix assumed a layout instead of measuring one.
 *
 * The token itself is intact inside a single item, which is how a shape-only grep
 * located it in the leaked fixture of the first attempt. Shape is therefore the
 * property to match on, and it needs no layout assumption at all. The two
 * constraints exclude this document's near-misses: the ten-digit RG carries no
 * letter, and lowercase ten-letter words like "informando" carry no digit.
 */
const CODIGO_VERIFICACAO_PATTERN =
  /\b(?=[0-9a-z]{10}\b)(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{10}\b/;

/**
 * Shapes personal data takes in this document, each with the complete set of
 * values it is allowed to still have after redaction.
 *
 * This gate is deliberately independent of discovery. An earlier version checked
 * only the values it had found, which meant a field it *failed* to find sailed
 * through: the verification code's phrase wraps across two text items, the
 * label-based search missed it, and the script reported success over a fixture
 * that still carried the real code in all three footers. A shape the script
 * never looked for is exactly the shape that needs catching.
 */
const FORMAS_PERMITIDAS: { nome: string; forma: RegExp; permitidos: string[] }[] = [
  { nome: 'CPF', forma: /\d{3}\.\d{3}\.\d{3}-\d{2}/g, permitidos: ['111.222.333-44'] },
  {
    nome: 'documento com órgão expedidor',
    forma: /\d{6,}, \(\w+\/[A-Z]{2}\)/g,
    permitidos: ['9999999999, (SSP/BA)'],
  },
  { nome: 'matrícula', forma: /\b\d{9}\b/g, permitidos: ['209900011'] },
  {
    nome: 'código de verificação',
    // Same shape the discovery pass uses, so the gate cannot be narrower than
    // what it is policing.
    forma: /\b(?=[0-9a-z]{10}\b)(?=[0-9a-z]*\d)(?=[0-9a-z]*[a-z])[0-9a-z]{10}\b/g,
    permitidos: ['aaaa1111bb'],
  },
];

/** A docente line ends in its workload: "Dr. FULANO DE TAL (60h)". */
const DOCENTE_SUFIXO = /\(\s*\d+\s*h\s*\)\s*$/i;

/**
 * The equivalências line shares that suffix but names components, not a person:
 * "Cumpriu GENG0032 - CIÊNCIAS DO AMBIENTE (60h) através de ENG269 - ...". It has
 * to survive untouched, because Task 5's spec asserts on its text.
 */
const EQUIVALENCIA_MARCA = /através de/i;

/** Optional academic title, preserved so the parser still meets the variety it handles. */
const TITULO_DOCENTE = /^((?:Dr|Dra|MSc|Me|Esp|Prof|Profa)\.\s*)/i;

/**
 * Invented professors. A pool rather than one name so distinct real docentes stay
 * distinct in the fixture — nothing asserts on that, but a fixture where every
 * course shares one professor misrepresents the document's shape.
 */
const NOMES_FICTICIOS = [
  'ANA PEREIRA LIMA',
  'BRUNO CARDOSO MELO',
  'CARLA NUNES ROCHA',
  'DIEGO ALVES PINTO',
  'ELISA MOURA BRAGA',
  'FABIO TEIXEIRA SOUZA',
  'GISELE RAMOS DUARTE',
  'HENRIQUE VIEIRA COSTA',
];

/** Splits a docente line into its parts, or null when the item is not one. */
function partesDoDocente(
  texto: string,
): { titulo: string; nome: string; sufixo: string } | null {
  if (!DOCENTE_SUFIXO.test(texto) || EQUIVALENCIA_MARCA.test(texto)) {
    return null;
  }
  const sufixo = DOCENTE_SUFIXO.exec(texto)?.[0] ?? '';
  const semSufixo = texto.slice(0, texto.length - sufixo.length);
  const titulo = TITULO_DOCENTE.exec(semSufixo)?.[1] ?? '';
  const nome = semSufixo.slice(titulo.length).trim();
  return nome ? { titulo, nome, sufixo } : null;
}

/** The value painted beside `rotulo`: same y, next item to the right. */
function valorAoLadoDe(itens: ItemTexto[], rotulo: string): string | null {
  const label = itens.find((i) => i.texto === rotulo || i.texto.startsWith(rotulo));
  if (!label) {
    return null;
  }

  // Some deploys paint the label and its value as one run ("Matrícula: 123").
  const embutido = label.texto.slice(rotulo.length).trim();
  if (embutido) {
    return embutido;
  }

  return (
    itens
      .filter(
        (i) =>
          i !== label &&
          i.pagina === label.pagina &&
          Math.abs(i.y - label.y) <= 1.5 &&
          i.x > label.x,
      )
      .sort((a, b) => a.x - b.x)[0]?.texto ?? null
  );
}

async function main(): Promise<void> {
  const caminho = process.argv[2];
  if (!caminho) {
    throw new Error('Informe o caminho do PDF do histórico.');
  }

  const itens = await extrairItensHistorico(readFileSync(caminho));

  const substituicoes: { real: string; ficticio: string }[] = [];
  for (const { rotulo, ficticio } of CAMPOS_SENSIVEIS) {
    const real = valorAoLadoDe(itens, rotulo);
    if (!real) {
      // A label this script cannot find is a field it cannot redact. Refuse
      // rather than write a fixture that silently keeps real data.
      throw new Error(
        `Não achei o valor do campo "${rotulo}" — o layout mudou, e sem ele a ` +
          'anonimização estaria incompleta.',
      );
    }
    substituicoes.push({ real, ficticio });
  }

  // One pass over individual items, matching the token's shape. No layout
  // assumption: the phrase around it wraps, the token does not.
  let achouCodigo = false;
  for (const item of itens) {
    const match = CODIGO_VERIFICACAO_PATTERN.exec(item.texto);
    if (match) {
      substituicoes.push({ real: match[0], ficticio: 'aaaa1111bb' });
      achouCodigo = true;
      break;
    }
  }
  if (!achouCodigo) {
    throw new Error(
      'Não achei o código de verificação no rodapé — sem ele a anonimização ' +
        'estaria incompleta.',
    );
  }

  // Longest first: replacing the matrícula before the RG would corrupt an RG
  // that happens to contain it as a substring.
  substituicoes.sort((a, b) => b.real.length - a.real.length);

  const comValoresTrocados = itens.map((item) => {
    let texto = item.texto;
    for (const { real, ficticio } of substituicoes) {
      texto = texto.split(real).join(ficticio);
    }
    return { ...item, texto };
  });

  // Docente names are a category the two gates below cannot see: gate 1 only knows
  // values discovered by label, and every shape in gate 2 is a numeric code. A real
  // person's name passes both — which is how 43 of them once reached a committed
  // fixture. They are redacted here, by the same shape rule the parser itself uses
  // to tell a docente line from a wrapped component name.
  const porDocente = new Map<string, string>();
  const anonimos = comValoresTrocados.map((item) => {
    const partes = partesDoDocente(item.texto);
    if (!partes) {
      return item;
    }

    let ficticio = porDocente.get(partes.nome);
    if (!ficticio) {
      const indice = porDocente.size;
      const base = NOMES_FICTICIOS[indice % NOMES_FICTICIOS.length];
      const volta = Math.floor(indice / NOMES_FICTICIOS.length);
      ficticio = volta === 0 ? base : `${base} ${volta + 1}`;
      porDocente.set(partes.nome, ficticio);
    }

    return { ...item, texto: `${partes.titulo}${ficticio} ${partes.sufixo}`.trim() };
  });

  const serializado = JSON.stringify(anonimos, null, 2);

  // Gate 1: nothing the script discovered may survive.
  const vazando = substituicoes.filter(({ real }) => serializado.includes(real));
  if (vazando.length > 0) {
    throw new Error(
      `${vazando.length} valor(es) pessoal(is) sobreviveram à anonimização. ` +
        'Fixture NÃO escrita.',
    );
  }

  // Gate 2: and nothing SHAPED like personal data may remain unless it is one of
  // the fictional values. This is the gate that does not trust gate 1's inputs —
  // it catches a field the script never managed to discover.
  for (const { nome, forma, permitidos } of FORMAS_PERMITIDAS) {
    const encontrados = [...new Set(serializado.match(forma) ?? [])];
    const inesperados = encontrados.filter((valor) => !permitidos.includes(valor));
    if (inesperados.length > 0) {
      // Report the count and the field, never the values themselves.
      throw new Error(
        `${inesperados.length} valor(es) com a forma de "${nome}" não estão na ` +
          'lista de valores fictícios. Fixture NÃO escrita.',
      );
    }
  }

  // Gate 3: every docente line must now name an invented professor. Same
  // discovery-independent principle as gate 2, applied to the category gate 2's
  // numeric shapes cannot express.
  for (const item of anonimos) {
    const partes = partesDoDocente(item.texto);
    if (partes && !NOMES_FICTICIOS.some((nome) => partes.nome.startsWith(nome))) {
      throw new Error(
        'Uma linha de docente não nomeia um professor fictício. Fixture NÃO escrita.',
      );
    }
  }

  const destino = join(
    __dirname,
    '..',
    'src',
    'sigaa-engine',
    'parsers',
    '__fixtures__',
    'historico-itens.json',
  );
  writeFileSync(destino, `${serializado}\n`);
  console.log(
    `${anonimos.length} itens escritos em ${destino} ` +
      `(${substituicoes.length} valores e ${porDocente.size} docentes anonimizados)`,
  );
}

void main();
