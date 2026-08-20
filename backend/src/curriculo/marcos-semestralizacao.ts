import type {
  ComponenteCurricularSalvo,
  EstruturaCurricularSalva,
} from './curriculo.repository';
import type { Historico } from '../sigaa-engine/parsers/historico';

/** A milestone on the workload progress bar: end of one grade período. */
export interface MarcoSemestre {
  periodo: number;
  /** Sum of obrigatória cargaHoraria expected through this período, inclusive. */
  cargaHorariaAcumulada: number;
  /**
   * `cargaHorariaAcumulada / totalExigida * 100`. `totalExigida` is the
   * obrigatórias-only requirement (see `montarMarcosResponse`), so this
   * reaches 100 exactly when the last marco's período is fully cursado —
   * it is the obrigatórias progress bar's own scale, not the whole curso's.
   */
  percentual: number;
}

/**
 * Only obrigatórias carry a período in the grade — optativas and
 * complementares are free-standing, so they cannot anchor a milestone.
 */
export function calcularMarcos(
  componentes: ComponenteCurricularSalvo[],
  totalExigida: number,
): MarcoSemestre[] {
  const porPeriodo = new Map<number, number>();
  for (const c of componentes) {
    if (c.periodo === null) {
      continue;
    }
    porPeriodo.set(
      c.periodo,
      (porPeriodo.get(c.periodo) ?? 0) + c.cargaHoraria,
    );
  }

  const periodos = [...porPeriodo.keys()].sort((a, b) => a - b);
  let acumulada = 0;
  return periodos.map((periodo) => {
    acumulada += porPeriodo.get(periodo)!;
    return {
      periodo,
      cargaHorariaAcumulada: acumulada,
      percentual: (acumulada / totalExigida) * 100,
    };
  });
}

export type Ritmo = 'adiantado' | 'no_ritmo' | 'atrasado';

/**
 * Compares what the student has actually integralizado against the marco for
 * `periodoAlvo` — the grade's expected cumulative workload through that
 * período. Callers pass `periodoLetivoAtual - 1`, not `periodoLetivoAtual`
 * itself: SIGAA's "período letivo atual" counts the semester still in
 * progress, but `integralizadaTotal` only ever includes componentes with a
 * final grade — the running semester never contributes to it. Comparing
 * against the running semester's own marco would call every student atrasado
 * by construction, even one exactly on pace.
 *
 * A `periodoAlvo` past the last marco (student is deep into the course, or
 * the grade ends earlier than their enrollment) falls back to the last
 * marco — nothing further ahead to compare against. A `periodoAlvo` before
 * the first marco (still in their very first período, nothing fechado yet)
 * compares against a zero baseline instead of falling back to the last marco,
 * which would wrongly call a brand-new student atrasado.
 */
export function compararRitmo(
  marcos: MarcoSemestre[],
  periodoAlvo: number,
  integralizadaTotal: number,
): Ritmo | null {
  if (marcos.length === 0) {
    return null;
  }

  if (periodoAlvo < marcos[0].periodo) {
    return integralizadaTotal > 0 ? 'adiantado' : 'no_ritmo';
  }

  const marco = marcos.find((m) => m.periodo === periodoAlvo) ?? marcos[marcos.length - 1];

  if (integralizadaTotal > marco.cargaHorariaAcumulada) {
    return 'adiantado';
  }
  if (integralizadaTotal < marco.cargaHorariaAcumulada) {
    return 'atrasado';
  }
  return 'no_ritmo';
}

export type ClassificacaoComponente =
  | { status: 'atual' }
  | { status: 'equivalente'; equivalenteDe: string }
  | { status: 'obsoleta' };

function escapeRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Tells apart a student's histórico código that is still on the active grade
 * from one the grade dropped — and, for a dropped one, whether some active
 * componente's `equivalencias` free text names it as the code it replaced.
 * `equivalencias` is raw SIGAA text like "(ENG295A) OU (ENG295B)"; a whole-word
 * regex match is enough to find a listed código without parsing the boolean
 * expression itself (out of scope — see the curriculo design spec).
 */
export function classificarComponente(
  codigo: string,
  componentesAtivos: ComponenteCurricularSalvo[],
): ClassificacaoComponente {
  if (componentesAtivos.some((c) => c.codigo === codigo)) {
    return { status: 'atual' };
  }

  const padrao = new RegExp(`\\b${escapeRegExp(codigo)}\\b`);
  const equivalente = componentesAtivos.find(
    (c) => c.equivalencias !== null && padrao.test(c.equivalencias),
  );
  if (equivalente) {
    return { status: 'equivalente', equivalenteDe: equivalente.codigo };
  }

  return { status: 'obsoleta' };
}

export interface MarcosResponse {
  marcos: MarcoSemestre[];
  ritmo: Ritmo | null;
  obsoletas: string[];
  equivalencias: { codigo: string; equivalenteDe: string }[];
}

/**
 * Composes the three pieces above into what the Trajetória screen needs:
 * milestones on the current scale, a pace verdict, and — for every código
 * the student has actually cursado or has pending — whether it fell off the
 * active grade, and if so whether that grade names a replacement for it.
 */
export function montarMarcosResponse(
  estrutura: EstruturaCurricularSalva,
  historico: Historico,
): MarcosResponse {
  // obrigatorias.exigida, not total.exigida: this is the milestone bar's own
  // scale now that optativas/complementares get their own bars on the
  // Trajetória screen — the last marco should reach 100% the moment every
  // obrigatória is done, not stay short forever because optativas/
  // complementares (which carry no período, so no marco of their own) still
  // have hours outstanding.
  const marcos = calcularMarcos(
    estrutura.componentes,
    historico.cargaHoraria.obrigatorias.exigida,
  );
  // periodoLetivoAtual - 1: the current período is still in progress, and
  // integralizada never counts it — see compararRitmo's own doc comment.
  const ritmo = compararRitmo(
    marcos,
    historico.periodoLetivoAtual - 1,
    historico.cargaHoraria.total.integralizada,
  );

  const codigos = new Set([
    ...historico.cursados.map((c) => c.codigo),
    ...historico.pendentesObrigatorios.map((p) => p.codigo),
  ]);

  const obsoletas: string[] = [];
  const equivalencias: { codigo: string; equivalenteDe: string }[] = [];
  for (const codigo of codigos) {
    const classificacao = classificarComponente(codigo, estrutura.componentes);
    if (classificacao.status === 'obsoleta') {
      obsoletas.push(codigo);
    } else if (classificacao.status === 'equivalente') {
      equivalencias.push({
        codigo,
        equivalenteDe: classificacao.equivalenteDe,
      });
    }
  }

  return { marcos, ritmo, obsoletas, equivalencias };
}
