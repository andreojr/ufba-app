import type { AppIconName } from "../components/AppIcon";
import { parseIsoDate, startOfDay } from "./periodo-letivo";
import type {
  ComponenteCursado,
  ComponentePendente,
  MarcoSemestre,
  MarcosSemestralizacao,
  ResumoCargaHoraria,
  Ritmo,
} from "./types";

export interface PeriodoTrajetoria {
  semestre: string;
  emCurso: boolean;
  componentes: ComponenteCursado[];
}

/** Which insight the tabs at the top of the trajectory focus on. */
export type Insight = "cr" | "cargaHoraria";

/** Left to right: swiping toward the next one moves right through this list. */
const ORDEM_INSIGHT: readonly Insight[] = ["cargaHoraria", "cr"];

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
 * Only the terms with at least one graded component — a term that's only
 * `MATR` so far has nothing to show in the CR-impact card (no delta, no
 * weight breakdown), so it's dropped rather than rendered empty.
 */
export function periodosComNota(periodos: PeriodoTrajetoria[]): PeriodoTrajetoria[] {
  return periodos.filter((periodo) => periodo.componentes.some((c) => c.nota !== null));
}

/** "2023.2" → "23.2" — compact enough for the impact card's narrow rows. */
export function rotuloSemestreCurto(semestre: string): string {
  return semestre.slice(2);
}

/**
 * How much a term's own CR moved from the term right before it — same
 * subtraction as `variacaoUltimoPeriodo`, but for every term in the series
 * instead of just the latest one. The first term has nothing before it to
 * compare against, so its own delta is always null (not zero — there's no
 * "held steady" here, there's nothing to measure).
 */
export function deltasCrPorPeriodo(
  serie: { semestre: string; cr: number | null }[],
): (number | null)[] {
  return serie.map((ponto, indice) => {
    if (indice === 0) {
      return null;
    }
    const anterior = serie[indice - 1].cr;
    if (ponto.cr === null || anterior === null) {
      return null;
    }
    return ponto.cr - anterior;
  });
}

/** Which color band a grade falls into, for the peso-das-notas segments. */
export type FaixaNota = "alta" | "media" | "baixa";

export function faixaNota(nota: number): FaixaNota {
  if (nota >= 7) {
    return "alta";
  }
  if (nota >= 5) {
    return "media";
  }
  return "baixa";
}

export interface PesoNota {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  nota: number;
  /** Share of the term's total graded carga horária, rounded to a whole percent. */
  pesoPercentual: number;
  faixa: FaixaNota;
}

/**
 * How much each graded component in a term weighs toward that term's own CR
 * contribution — the carga-horária share the weighted average
 * (`crPonderado`) actually gives it. Ungraded components (trancada,
 * matriculada) don't enter the weighted average, so they carry no weight
 * here either. Sorted heaviest first: the segment that would move the CR
 * most sits first in both the bar and its legend.
 */
export function pesoDasNotas(componentes: ComponenteCursado[]): PesoNota[] {
  const comNota = componentes.filter(
    (c): c is ComponenteCursado & { nota: number } => c.nota !== null,
  );
  const pesoTotal = somarCargaHoraria(comNota);
  if (pesoTotal === 0) {
    return [];
  }
  return comNota
    .map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      cargaHoraria: c.cargaHoraria,
      nota: c.nota,
      pesoPercentual: Math.round((c.cargaHoraria / pesoTotal) * 100),
      faixa: faixaNota(c.nota),
    }))
    .sort((a, b) => b.cargaHoraria - a.cargaHoraria);
}

export interface ImpactoComponente {
  codigo: string;
  nome: string;
  nota: number;
  impacto: number;
}

/**
 * The components from one term with the biggest pull on the overall CR
 * (`impactoNoCr`, reused as-is), biggest magnitude first — the drill-down a
 * tap on that term's bar in the impact-per-semester chart opens.
 */
export function maioresImpactos(
  cursados: ComponenteCursado[],
  semestre: string,
  limite = 3,
): ImpactoComponente[] {
  return cursados
    .filter((c) => c.semestre === semestre && c.nota !== null)
    .map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      nota: c.nota as number,
      impacto: impactoNoCr(cursados, c.codigo),
    }))
    .filter((c): c is ImpactoComponente => c.impacto !== null)
    .sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto))
    .slice(0, limite);
}

/**
 * Every graded component from one term and its pull on the overall CR,
 * biggest positive pull first down to the biggest negative one — signed
 * order, not by magnitude like `maioresImpactos`, and nothing is dropped.
 * This is what the "Notas por impacto pelo semestre" carousel page for this
 * term shows: every grade that moved the CR, ranked top to bottom.
 */
export function impactosPorSemestre(
  cursados: ComponenteCursado[],
  semestre: string,
): ImpactoComponente[] {
  return cursados
    .filter((c) => c.semestre === semestre && c.nota !== null)
    .map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      nota: c.nota as number,
      impacto: impactoNoCr(cursados, c.codigo),
    }))
    .filter((c): c is ImpactoComponente => c.impacto !== null)
    .sort((a, b) => b.impacto - a.impacto);
}

/**
 * The arrow + number shown beside a graded component, every place a CR
 * impact/delta is displayed (the top card's variação, a term's own delta, a
 * component's pull on the CR). In centésimos, not the CR's own two decimals —
 * these moves are small enough (0,06, 0,01) that "6" and "1" read far more
 * naturally than "0,06" and "0,01" do. No arrow for zero, or for a value that
 * rounds to zero centésimos — an arrow on a change that isn't there would
 * read as one that is.
 */
export function formatarImpacto(impacto: number | null): string {
  if (impacto === null) {
    return "—";
  }
  const centesimos = Math.round(Math.abs(impacto) * 100);
  if (centesimos === 0) {
    return "—";
  }
  const seta = impacto > 0 ? "↑" : "↓";
  return `${seta} ${centesimos}`;
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
const ROTULOS_RITMO: Record<Ritmo, string> = {
  adiantado: "Adiantado(a)",
  no_ritmo: "No ritmo",
  atrasado: "Atrasado(a)",
};

/** The label beside the workload bar's semestralização marks. Null when ritmo never resolved. */
export function rotuloRitmo(ritmo: Ritmo | null): string | null {
  return ritmo === null ? null : ROTULOS_RITMO[ritmo];
}

export type StatusComponente =
  | { tipo: "obsoleta" }
  | { tipo: "equivalente"; equivalenteDe: string };

/**
 * The badge a trajectory card shows for a componente the active grade no
 * longer carries — obsoleta with no known replacement, or equivalente to a
 * componente the grade names instead. Null covers both "still on the grade"
 * and "marcos never resolved" — the card has nothing to flag either way.
 */
export function statusComponente(
  codigo: string,
  marcos: MarcosSemestralizacao | null,
): StatusComponente | null {
  if (!marcos) {
    return null;
  }
  if (marcos.obsoletas.includes(codigo)) {
    return { tipo: "obsoleta" };
  }
  const equivalencia = marcos.equivalencias.find((e) => e.codigo === codigo);
  return equivalencia ? { tipo: "equivalente", equivalenteDe: equivalencia.equivalenteDe } : null;
}

/**
 * The status card that hangs off the bottom of a matéria card, and null for
 * the ordinary case, which is most of them: a matéria only earns one when it
 * *deviates* from what its período header already says. "Aprovada" and "em
 * curso" travel in herds — every componente in a closed período is approved,
 * every one in the open período is being taken — so a card for them would be
 * repeating the header once per matéria.
 *
 * Two axes can fire at once (a reprovada that also left the grade). The
 * situação wins: a reprovada fora da grade is a reprovada first.
 */
export interface FaixaComponente {
  /** Literal Tailwind classes, never built by concatenation — the JIT only sees whole strings. */
  corFundo: string;
  corTexto: string;
  rotulo: string;
}

/** Soft fills, not solid: this card sits under every deviating matéria in a
 *  dense grid, and a saturated block per card would read as an alarm the
 *  transcript is not raising. Same soft/solid pairing the período badges above
 *  the grid already use. */
const FAIXAS_SITUACAO: Record<string, { corFundo: string; corTexto: string }> = {
  REP: { corFundo: "bg-danger-soft", corTexto: "text-danger" },
  REPF: { corFundo: "bg-danger-soft", corTexto: "text-danger" },
  REPMF: { corFundo: "bg-danger-soft", corTexto: "text-danger" },
  TRANC: { corFundo: "bg-warning-soft", corTexto: "text-warning" },
  CANC: { corFundo: "bg-warning-soft", corTexto: "text-warning" },
  // Counted toward the curso without having been cursado in this período —
  // the same "it's here but it didn't happen here" family, hence one colour.
  DISP: { corFundo: "bg-accent-soft", corTexto: "text-accent" },
  CUMP: { corFundo: "bg-accent-soft", corTexto: "text-accent" },
  TRANS: { corFundo: "bg-accent-soft", corTexto: "text-accent" },
  INCORP: { corFundo: "bg-accent-soft", corTexto: "text-accent" },
};

/** No colour to claim: the grade moved on, which is not good or bad news. */
const FAIXA_NEUTRA = { corFundo: "bg-white/5", corTexto: "text-muted" };

export function faixaComponente(
  situacao: string,
  status: StatusComponente | null,
): FaixaComponente | null {
  const rotulo = rotuloSituacao(situacao);
  // rotuloSituacao returns null only for APR, and MATR is the other situação
  // the período header already covers. Everything else is a deviation.
  if (rotulo !== null && situacao !== SITUACAO_MATRICULADO) {
    // An unmapped code means SIGAA's legend grew: the neutral fill plus the
    // raw code, rather than a colour that would claim to know what it means.
    return { ...(FAIXAS_SITUACAO[situacao] ?? FAIXA_NEUTRA), rotulo };
  }
  if (status?.tipo === "equivalente") {
    return {
      corFundo: "bg-success-soft",
      corTexto: "text-success",
      rotulo: `equivale a ${status.equivalenteDe}`,
    };
  }
  if (status?.tipo === "obsoleta") {
    return { ...FAIXA_NEUTRA, rotulo: "fora da grade atual" };
  }
  return null;
}

/** One bar in the workload progress bar's segmented rendering — one per período the grade has a marco for. */
export interface SegmentoSemestralizacao {
  periodo: number;
  /** This segmento's own share of the whole bar's width — never the running total. */
  larguraPercentual: number;
  /** 0 (not reached), 1 (fully cursado), or the fraction in between for the período in progress. */
  preenchimento: number;
}

/**
 * Splits the single workload bar into one segmento per marco, each sized by
 * its own share of the total (this marco's cargaHorariaAcumulada minus the
 * previous one's — never the running total, which is what would make later
 * segmentos balloon in width). `integralizadaTotal` fills each segmento in
 * order: full for every período already surpassed, a proportional fraction
 * for the one currently being cursado, empty for every período still ahead.
 */
export function segmentosSemestralizacao(
  marcos: MarcoSemestre[],
  integralizadaTotal: number,
): SegmentoSemestralizacao[] {
  let percentualAnterior = 0;
  let acumuladaAnterior = 0;
  return marcos.map((marco) => {
    const larguraPercentual = marco.percentual - percentualAnterior;
    const cargaDoSegmento = marco.cargaHorariaAcumulada - acumuladaAnterior;
    const noSegmento = integralizadaTotal - acumuladaAnterior;
    const preenchimento =
      cargaDoSegmento === 0 ? (noSegmento >= 0 ? 1 : 0) : Math.min(1, Math.max(0, noSegmento / cargaDoSegmento));

    percentualAnterior = marco.percentual;
    acumuladaAnterior = marco.cargaHorariaAcumulada;
    return { periodo: marco.periodo, larguraPercentual, preenchimento };
  });
}

export interface PosicaoSemestral {
  /** How many segmentos are fully preenchido — whole semesters' worth of workload done. */
  concluidos: number;
  total: number;
  /** `concluidos` plus the in-progress segmento's own fraction — e.g. 5.3 of 10. */
  posicaoFracionaria: number;
}

/**
 * Reduces the bar's own segmentos into the two numbers the screen states
 * outright: how many semesters' worth of workload are actually done, and the
 * fractional position that — set beside `periodoLetivoAtual`, how many
 * semesters the student has actually been enrolled — is what justifies
 * calling them adiantado, atrasado, or on ritmo.
 */
/** One decimal, comma — same convention as formatarCoeficiente, one digit narrower. */
export function formatarSemestre(valor: number): string {
  return valor.toFixed(1).replace(".", ",");
}

export function posicaoSemestral(segmentos: SegmentoSemestralizacao[]): PosicaoSemestral {
  return {
    concluidos: segmentos.filter((s) => s.preenchimento >= 1).length,
    total: segmentos.length,
    posicaoFracionaria: segmentos.reduce((soma, s) => soma + s.preenchimento, 0),
  };
}

/** How dense a matéria's workload is, purely by its carga horária — nothing
 * here is a fraction of a total, so it never reads as progress toward one. */
export type NivelDensidade = 1 | 2 | 3 | 4;

/**
 * The tier vocabulary: a glyph and the words for it.
 *
 * A progression of "how much material is in this matéria" — uma folha, várias
 * folhas, um livro, uma bandeja cheia. The first two steps multiply the same
 * object, so they carry their own order; the 3→4 step changes object, and that
 * is the part the legend earns its place explaining.
 *
 * All four come from Ionicons deliberately. An earlier pass reached into
 * MaterialCommunityIcons for a multiple-books glyph, but two families inside a
 * four-step scale means two stroke weights in the one place that can least
 * afford it — the legend line, where all four sit side by side.
 *
 * Deliberately no color. The card already spends verde/âmbar/vermelho on the
 * nota (see gradeColor), and a second ramp in the opposite corner meaning
 * something else entirely is what made this cue unreadable.
 */
const ESCALA_DENSIDADE: Record<
  NivelDensidade,
  { icone: AppIconName; rotulo: string; curto: string }
> = {
  1: { icone: "IconPaper", rotulo: "Carga leve", curto: "leve" },
  2: { icone: "IconPapers", rotulo: "Carga média", curto: "média" },
  3: { icone: "IconBook", rotulo: "Carga pesada", curto: "pesada" },
  4: { icone: "IconTrayFull", rotulo: "Carga muito densa", curto: "muito densa" },
};

/** Every tier, lightest first — what the legend at the top of the aba walks through. */
export const ESCALA_DENSIDADE_ORDENADA = [1, 2, 3, 4].map((nivel) => ({
  nivel: nivel as NivelDensidade,
  ...ESCALA_DENSIDADE[nivel as NivelDensidade],
}));

/**
 * Classifies a componente's carga horária into one of four density tiers.
 * Cuts sit at 50/75/100h so a 90h componente (um livro) reads as heavier than
 * a 60-68h one (várias folhas) but lighter than a 120h one (uma bandeja cheia) —
 * the two ends of the range this app's transcripts actually carry.
 */
export function densidadeCarga(horas: number): {
  nivel: NivelDensidade;
  icone: AppIconName;
  rotulo: string;
  curto: string;
} {
  const nivel: NivelDensidade = horas <= 50 ? 1 : horas <= 75 ? 2 : horas <= 100 ? 3 : 4;
  return { nivel, ...ESCALA_DENSIDADE[nivel] };
}

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
