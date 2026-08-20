import { parseIsoDate, startOfDay } from "./periodo-letivo";
import type { ComponenteCursado, ComponentePendente, ResumoCargaHoraria } from "./types";

export interface PeriodoTrajetoria {
  semestre: string;
  emCurso: boolean;
  componentes: ComponenteCursado[];
}

/** Which insight the tabs at the top of the trajectory focus on. */
export type Insight = "cr" | "cargaHoraria";

/** Left to right: swiping toward the next one moves right through this list. */
const ORDEM_INSIGHT: readonly Insight[] = ["cr", "cargaHoraria"];

/** Below this, a pan reads as a tap or a scroll correction, not a swipe. */
const LIMIAR_SWIPE_PX = 40;

/** Which way a swipe steps through the tabs — left moves to the next one. */
export type DirecaoSwipe = "esquerda" | "direita";

/**
 * Which way a completed pan gesture is swiping — null when it doesn't count
 * as a swipe at all: too short, or leaning more vertical than horizontal,
 * which is a scroll the vertical ScrollView should keep instead. Marked as a
 * worklet so the trajectory screen's gesture can call it directly on the UI
 * thread, at the moment the finger lifts — not just from plain JS, which is
 * all this file's own tests exercise.
 */
export function direcaoDoSwipe(translationX: number, translationY: number): DirecaoSwipe | null {
  "worklet";
  if (Math.abs(translationX) < LIMIAR_SWIPE_PX || Math.abs(translationX) <= Math.abs(translationY)) {
    return null;
  }
  // Swiping left drags the *next* card into view, same convention as a page
  // carousel — so a negative translationX (finger moving left) steps forward.
  return translationX < 0 ? "esquerda" : "direita";
}

/**
 * Which insight a swipe in `direcao` should land on — clamped, not circular:
 * stepping past the last tab (or before the first) simply does nothing, the
 * same way a real tab view would.
 */
export function proximoInsight(atual: Insight, translationX: number, translationY: number): Insight {
  const direcao = direcaoDoSwipe(translationX, translationY);
  if (!direcao) {
    return atual;
  }
  const indice = ORDEM_INSIGHT.indexOf(atual);
  const proximo = direcao === "esquerda" ? indice + 1 : indice - 1;
  return ORDEM_INSIGHT[proximo] ?? atual;
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
      // and more reliable than comparing dates.
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
 * How many obligatory components are still missing — unlike `poolPlanejavel`,
 * this counts a component the student is already taking too: the planner
 * shouldn't offer to move something already placed, but "how many left" isn't
 * done just because it's enrolled and waiting on a grade.
 */
export function contarFaltantes(pendentes: ComponentePendente[]): number {
  return pendentes.filter((p) => p.codigo !== CODIGO_ENADE).length;
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

export interface AnoTrajetoria {
  ano: string;
  periodos: PeriodoTrajetoria[];
}

/** Groups already-ordered periods by the year in their "AAAA.N" semestre. */
export function agruparPorAno(periodos: PeriodoTrajetoria[]): AnoTrajetoria[] {
  const porAno = new Map<string, PeriodoTrajetoria[]>();
  for (const periodo of periodos) {
    const ano = periodo.semestre.slice(0, 4);
    porAno.set(ano, [...(porAno.get(ano) ?? []), periodo]);
  }
  return [...porAno.entries()].map(([ano, periodos]) => ({ ano, periodos }));
}

/**
 * Situações that must not add hours to the carga horária chart: trancada and
 * cancelada are abandoned — the student never carried that load to a result.
 * Everything else — reprovada, and matriculada-sem-nota for the term still in
 * progress — occupied the student's semester and counts.
 */
const SITUACOES_FORA_DA_CARGA_HORARIA: readonly string[] = ["TRANC", "CANC"];

/** Which of a period's components should count toward its carga horária. */
export function componentesComCargaHorariaContada(
  componentes: ComponenteCursado[],
): ComponenteCursado[] {
  return componentes.filter((c) => !SITUACOES_FORA_DA_CARGA_HORARIA.includes(c.situacao));
}

/** Total carga horária of a set of components — a period's, most of the time. */
export function somarCargaHoraria(componentes: ComponenteCursado[]): number {
  return componentes.reduce((soma, c) => soma + c.cargaHoraria, 0);
}

/**
 * The weighted-average formula the transcript's own CR is built from — see
 * `historico.service.ts`'s `validarInvariantes` on the backend, which checks
 * the printed CR against this same computation. Returns null when nothing in
 * `cursados` has a grade yet.
 */
function crPonderado(cursados: ComponenteCursado[]): number | null {
  const comNota = cursados.filter((c) => c.nota !== null);
  const pesoTotal = somarCargaHoraria(comNota);
  if (pesoTotal === 0) {
    return null;
  }
  return comNota.reduce((soma, c) => soma + c.cargaHoraria * (c.nota as number), 0) / pesoTotal;
}

/**
 * The x-axis labels for a chart with one point per term: only the first term
 * of each year gets its year as a label, every later term in that year gets
 * an empty string. Two labelled points side by side ("2024" next to "2024")
 * would read as two different years — this is what keeps the axis showing
 * each year exactly once, at the term where it starts.
 */
export function rotulosPorAno(semestresOrdenados: string[]): string[] {
  const vistos = new Set<string>();
  return semestresOrdenados.map((semestre) => {
    const ano = semestre.slice(0, 4);
    if (vistos.has(ano)) {
      return "";
    }
    vistos.add(ano);
    return ano;
  });
}

/**
 * The CR line chart's series: for each term in `semestresOrdenados`, the CR
 * computed from every graded component up to and including that term — not
 * just that term's own grades, since the CR itself is defined as a running
 * average across the whole trajectory. A term with nothing graded yet (a
 * MATR-only period) simply carries the previous value forward.
 */
export function calcularCrAcumulado(
  cursados: ComponenteCursado[],
  semestresOrdenados: string[],
): { semestre: string; cr: number | null }[] {
  return semestresOrdenados.map((semestre, indice) => {
    const ateAqui = semestresOrdenados.slice(0, indice + 1);
    const acumulado = cursados.filter((c) => ateAqui.includes(c.semestre));
    return { semestre, cr: crPonderado(acumulado) };
  });
}

/**
 * How much the CR moved from the term before the latest one to the latest
 * one — what the summary card's "vs. último período" indicator shows beside
 * the current CR. Null with fewer than two terms (nothing to compare
 * against) or when either end has nothing graded yet.
 */
export function variacaoUltimoPeriodo(
  serie: { semestre: string; cr: number | null }[],
): number | null {
  if (serie.length < 2) {
    return null;
  }
  const atual = serie[serie.length - 1].cr;
  const anterior = serie[serie.length - 2].cr;
  if (atual === null || anterior === null) {
    return null;
  }
  return atual - anterior;
}

/**
 * How much a single graded component moves the overall CR: the CR with every
 * graded component, minus the CR computed with `codigo` left out. Positive
 * means the component pulled the CR up, negative means it pulled it down.
 *
 * Null covers both cases with nothing meaningful to show: `codigo` itself has
 * no grade (trancada/matriculada — it never entered the CR), or removing it
 * would leave nothing graded at all to compare against.
 */
export function impactoNoCr(cursados: ComponenteCursado[], codigo: string): number | null {
  const alvo = cursados.find((c) => c.codigo === codigo);
  if (!alvo || alvo.nota === null) {
    return null;
  }
  const completo = crPonderado(cursados);
  const semAlvo = crPonderado(cursados.filter((c) => c.codigo !== codigo));
  if (completo === null || semAlvo === null) {
    return null;
  }
  return completo - semAlvo;
}

/**
 * The arrow + number shown beside a graded component. No arrow for zero
 * impact or nothing to show — an up or down arrow on a value that rounds to
 * nothing would read as a change that isn't there.
 */
export function formatarImpacto(impacto: number | null): string {
  if (impacto === null || impacto === 0) {
    return "—";
  }
  const seta = impacto > 0 ? "↑" : "↓";
  return `${seta} ${formatarCoeficiente(Math.abs(impacto))}`;
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
  // as UTC midnight, which lands on the previous day in Brazil.
  const fim = parseIsoDate(fimDoPeriodo);
  // periodo-letivo.ts documents both term boundaries as inclusive — the last
  // day still counts as "curso", not "encerrado" — so `agora` must be
  // day-normalised before the comparison. Comparing raw timestamps would flag
  // the term stale from midnight on its own last day, hours before it ends by
  // this project's own definition. `startOfDay` is shared with periodo-letivo
  // rather than redefined here, so the two files cannot drift on what a day
  // boundary means.
  return startOfDay(agora) > fim;
}
