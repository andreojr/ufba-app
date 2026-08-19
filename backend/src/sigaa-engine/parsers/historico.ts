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
  'APR',
  'CANC',
  'DISP',
  'MATR',
  'REP',
  'REPF',
  'REPMF',
  'TRANC',
  'TRANS',
  'INCORP',
  'CUMP',
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

/**
 * A label whose value must be a number. `Number(exigirValor(...))` alone yields
 * NaN for a value the layout moved, which then persists as a plausible-looking
 * field instead of failing — the shape this parser is required to refuse.
 */
function exigirNumero(itens: ItemTexto[], rotulo: string): number {
  const bruto = exigirValor(itens, rotulo);
  const numero = Number(bruto);
  if (!Number.isFinite(numero)) {
    throw new Error(
      `Histórico não reconhecido: "${rotulo}" trouxe "${bruto}", que não é um número.`,
    );
  }
  return numero;
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

const EMITIDO_EM_PATTERN = /Emitido em:\s*(\d{2}\/\d{2}\/\d{4})/;
// "2030.1 / 2033.1" — padrão e máximo on one line.
const PRAZOS_PATTERN = /(\d{4}\.\d)\s*\/\s*(\d{4}\.\d)/;

function casarEmAlgumItem(
  itens: ItemTexto[],
  pattern: RegExp,
): RegExpExecArray {
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

  // A null CR is legitimate only for a transcript with nothing graded yet. With
  // graded components present, SIGAA always prints one — so a null here means the
  // label moved, and silently skipping the check would disable the strongest
  // evidence we have that the parser read the right cells at all.
  if (historico.indices.cr === null && pesoTotal > 0) {
    throw new Error(
      'Histórico inconsistente: não achei o CR, mas existem componentes com nota. ' +
        'O layout do documento pode ter mudado.',
    );
  }

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

export function parseHistorico(itens: ItemTexto[]): Historico {
  const emitidoEm = paraIso(casarEmAlgumItem(itens, EMITIDO_EM_PATTERN)[1]);
  const prazos = casarEmAlgumItem(itens, PRAZOS_PATTERN);

  const historico: Historico = {
    emitidoEm,
    curriculo: exigirValor(itens, 'Currículo:'),
    periodoLetivoAtual: exigirNumero(itens, 'Período Letivo Atual:'),
    prazoConclusaoPadrao: prazos[1],
    prazoConclusaoMaximo: prazos[2],
    indices: {
      cr: numeroOuNulo(valorAoLadoDe(itens, 'CR:')),
      iap: numeroOuNulo(valorAoLadoDe(itens, 'IAP:')),
    },
    cursados: parseCursados(itens),
    pendentesObrigatorios: parsePendentes(itens),
    cargaHoraria: parseCargaHoraria(itens),
    equivalencias: linhasDaSecao(itens, /^Equival[êe]ncias/),
    observacoes: linhasDaSecao(itens, /^Observa[çc][õo]es/),
  };

  const tituloPendentes = itens.find((i) => TITULO_PENDENTES_PATTERN.test(i.texto));
  const totalDeclarado = tituloPendentes
    ? Number(TITULO_PENDENTES_PATTERN.exec(tituloPendentes.texto)?.[1])
    : 0;

  validarInvariantes(historico, totalDeclarado);

  return historico;
}

export { SITUACOES, NATUREZAS };
