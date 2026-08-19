import type { PeriodoLetivo } from "./types";

/** Where today sits relative to the academic term. */
export type PeriodoPhase = "antes" | "curso" | "encerrado";

export interface PeriodoStatus {
  phase: PeriodoPhase;
  /** How much of the term has elapsed, 0 before it starts through 1 once it closes. */
  progress: number;
  /** Human countdown for the current phase, e.g. "faltam 70 dias". */
  countdown: string;
  /** Abbreviated month the term opens in, for the start of the track (e.g. "ago"). */
  inicioLabel: string;
  /** Abbreviated month the term closes in, for the end of the track (e.g. "dez"). */
  fimLabel: string;
}

const MONTHS_ABBR_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reads a `YYYY-MM-DD` string as a date on the *local* calendar.
 *
 * `new Date("2026-08-19")` is specified to parse as UTC midnight, which is
 * 21:00 on the 18th in Brazil — every term boundary would land a day early.
 */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Strips the time of day so two dates can be compared as calendar days. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days from `from` to `to`. Both are normalized to midnight
 * first, so this counts date boundaries crossed rather than 24h chunks — a DST
 * shift in between can't round the answer down.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY,
  );
}

function pluralizeDays(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}

/**
 * Describes the term relative to `now`: which phase it's in, how far along it
 * is, and the countdown to whichever boundary is next.
 *
 * Both boundaries are inclusive — the first and last days are part of the term,
 * since classes happen on them.
 */
export function describePeriodo(
  periodo: PeriodoLetivo,
  now: Date,
): PeriodoStatus {
  const inicio = parseIsoDate(periodo.inicio);
  const fim = parseIsoDate(periodo.fim);
  const labels = {
    inicioLabel: MONTHS_ABBR_PT[inicio.getMonth()],
    fimLabel: MONTHS_ABBR_PT[fim.getMonth()],
  };

  const untilStart = daysBetween(now, inicio);
  if (untilStart > 0) {
    return {
      ...labels,
      phase: "antes",
      progress: 0,
      countdown:
        untilStart === 1 ? "começa amanhã" : `começa em ${pluralizeDays(untilStart)}`,
    };
  }

  const untilEnd = daysBetween(now, fim);
  if (untilEnd < 0) {
    return { ...labels, phase: "encerrado", progress: 1, countdown: "período encerrado" };
  }

  const total = daysBetween(inicio, fim);
  const elapsed = daysBetween(inicio, now);
  return {
    ...labels,
    phase: "curso",
    // total is 0 only for a single-day term, where "all of it" is the honest answer.
    progress: total === 0 ? 1 : Math.min(1, Math.max(0, elapsed / total)),
    countdown:
      untilEnd === 0
        ? "último dia"
        : untilEnd === 1
          ? "termina amanhã"
          : elapsed === 0
            ? // Day one: that the term starts today beats "faltam 122 dias".
              "começa hoje"
            : `faltam ${pluralizeDays(untilEnd)}`,
  };
}

/** Whether `date` falls on or between the term's first and last days. */
export function isWithinPeriodo(date: Date, periodo: PeriodoLetivo): boolean {
  const day = startOfDay(date).getTime();
  return (
    day >= parseIsoDate(periodo.inicio).getTime() &&
    day <= parseIsoDate(periodo.fim).getTime()
  );
}
