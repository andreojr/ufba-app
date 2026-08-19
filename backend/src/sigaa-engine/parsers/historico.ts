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

export function parseHistorico(itens: ItemTexto[]): Historico {
  const emitidoEm = paraIso(casarEmAlgumItem(itens, EMITIDO_EM_PATTERN)[1]);
  const prazos = casarEmAlgumItem(itens, PRAZOS_PATTERN);

  return {
    emitidoEm,
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
