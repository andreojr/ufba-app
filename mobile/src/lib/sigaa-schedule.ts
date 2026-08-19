import { isWithinPeriodo } from "./periodo-letivo";
import type { PeriodoLetivo, Turma } from "./types";

/** Weekday names as they appear in `TurmaSlot.dia`, Monday–Friday only. */
export const WEEKDAY_NAMES = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] as const;

const WEEKDAY_SHORT_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex"] as const;

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export interface WeekDay {
  key: string;
  dayName: (typeof WEEKDAY_NAMES)[number];
  label: string;
  num: string;
  full: string;
  isToday: boolean;
  /** The actual calendar date, so callers can place the day inside the term. */
  date: Date;
}

/** Returns Monday–Friday of the week containing `now` (Saturday/Sunday are out of scope for the grid). */
export function getCurrentWeekDays(now: Date = new Date()): WeekDay[] {
  const jsDay = now.getDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = jsDay === 0 ? 6 : jsDay - 1;

  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);

  return WEEKDAY_NAMES.map((dayName, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    return {
      key: String(index),
      dayName,
      label: WEEKDAY_SHORT_LABELS[index],
      num: String(date.getDate()),
      full: `${dayName}, ${date.getDate()} de ${MONTHS_PT[date.getMonth()]}`,
      isToday,
      date,
    };
  });
}

/**
 * UFBA's class slots as [start, end] minutes since midnight, in the order they
 * run through the day: six 55-minute slots in the morning (M1–M6) and in the
 * afternoon (T1–T6), four at night (N1–N4). Mirrors the backend's SLOT_MINUTES
 * table in schedule-code.ts, which SIGAA's codes are decoded against.
 *
 * Note the gaps between shifts: the morning closes at 12:30 and the afternoon
 * opens at 13:00, so the day is not a uniform grid of 55-minute steps.
 */
const SIGAA_SLOTS: readonly (readonly [number, number])[] = [
  [420, 475], // M1  07:00
  [475, 530], // M2  07:55
  [530, 585], // M3  08:50
  [585, 640], // M4  09:45
  [640, 695], // M5  10:40
  [695, 750], // M6  11:35
  [780, 835], // T1  13:00
  [835, 890], // T2  13:55
  [890, 945], // T3  14:50
  [945, 1000], // T4  15:45
  [1000, 1055], // T5  16:40
  [1055, 1110], // T6  17:35
  [1110, 1165], // N1  18:30
  [1165, 1220], // N2  19:25
  [1220, 1275], // N3  20:20
  [1275, 1330], // N4  21:15
] as const;

/** Top of the weekly grid: when the first slot of the day opens (07:00). */
export const SCHEDULE_START_MIN = SIGAA_SLOTS[0][0];

/** Bottom of the weekly grid: when the last slot of the day closes (22:10). */
export const SCHEDULE_END_MIN = SIGAA_SLOTS[SIGAA_SLOTS.length - 1][1];

/**
 * Where the weekly grid draws its reference lines: the end of every second
 * slot — 08:50, 10:40, 12:30, 14:50, 16:40, 18:30, 20:20, 22:10.
 *
 * Classes are scheduled in 2-slot pairs (a "2N34" is N3 and N4 back to back),
 * so these boundaries are where a student's day genuinely breaks. Round clock
 * hours would land mid-class instead, drawing lines through the middle of every
 * block. Counting in pairs also means the lunch break is crossed rather than
 * marked: the morning closes at 12:30 and T1+T2 close at 14:50, so 13:00 gets
 * no line of its own.
 *
 * Lines only — the gutter labels stay on round hours, which are far narrower to
 * print. A class's real start and end are on its own card.
 */
export const GRID_TIME_MARKS: number[] = SIGAA_SLOTS.filter(
  (_, index) => index % 2 === 1,
).map(([, end]) => end);

export interface ScheduleBlock {
  key: string;
  codigo: string | null;
  nome: string;
  inicioMin: number;
  fimMin: number;
  predio: string | null;
  sala: string | null;
  localOriginal: string;
  colorIndex: number;
}

/** Color palette cycled by course, in order of first appearance across the week. */
export const SCHEDULE_PALETTE = [
  { fill: "rgba(139,92,246,0.22)", fg: "#A78BFA", bar: "#7C3AED" },
  { fill: "rgba(23,201,100,0.15)", fg: "#5BD891", bar: "#17C964" },
  { fill: "rgba(247,183,80,0.15)", fg: "#F8CE8C", bar: "#F7B750" },
  { fill: "rgba(56,189,248,0.18)", fg: "#7DD3FC", bar: "#0EA5E9" },
  { fill: "rgba(244,114,182,0.18)", fg: "#F9A8D4", bar: "#EC4899" },
  { fill: "rgba(148,163,184,0.18)", fg: "#CBD5E1", bar: "#64748B" },
] as const;

const WEEKDAY_INDEX: Record<string, number> = Object.fromEntries(
  WEEKDAY_NAMES.map((name, index) => [name, index]),
);

/**
 * Groups every turma's Monday–Friday slots into one array per weekday,
 * sorted by start time. Sábado slots (out of scope for the weekly grid) are
 * dropped with a console warning so they aren't silently lost from view.
 */
export function buildWeekSchedule(turmas: Turma[]): ScheduleBlock[][] {
  const rawByDay: Omit<ScheduleBlock, "colorIndex">[][] = WEEKDAY_NAMES.map(() => []);

  for (const turma of turmas) {
    for (const slot of turma.slots) {
      const dayIndex = WEEKDAY_INDEX[slot.dia];
      if (dayIndex === undefined) {
        console.warn(`Skipping schedule slot outside Monday–Friday: "${slot.dia}"`);
        continue;
      }
      rawByDay[dayIndex].push({
        key: `${turma.codigo ?? turma.nome}-${slot.dia}-${slot.inicioMin}`,
        codigo: turma.codigo,
        nome: turma.nome,
        inicioMin: slot.inicioMin,
        fimMin: slot.fimMin,
        predio: slot.predio,
        sala: slot.sala,
        localOriginal: slot.localOriginal,
      });
    }
  }

  for (const day of rawByDay) {
    day.sort((a, b) => a.inicioMin - b.inicioMin);
  }

  const colorIndexByCourse = new Map<string, number>();
  function colorIndexFor(courseKey: string): number {
    let index = colorIndexByCourse.get(courseKey);
    if (index === undefined) {
      index = colorIndexByCourse.size % SCHEDULE_PALETTE.length;
      colorIndexByCourse.set(courseKey, index);
    }
    return index;
  }

  return rawByDay.map((day) =>
    day.map((block) => ({
      ...block,
      colorIndex: colorIndexFor(block.codigo ?? block.nome),
    })),
  );
}

/**
 * Blanks out the days of `week` whose calendar date falls outside the academic
 * term, leaving the rest untouched. A null `periodo` masks nothing.
 *
 * A turma's weekly slots say "Segunda" with no notion of *which* Monday, so a
 * term that starts mid-week would otherwise show classes on the Monday and
 * Tuesday before it began. Apply this before `pickNextClass`, or the
 * "próxima aula" card will happily advertise one of those.
 */
export function maskWeekToPeriodo(
  week: ScheduleBlock[][],
  days: WeekDay[],
  periodo: PeriodoLetivo | null,
): ScheduleBlock[][] {
  if (!periodo) {
    return week;
  }
  return week.map((blocks, index) => {
    const day = days[index];
    return day && isWithinPeriodo(day.date, periodo) ? blocks : [];
  });
}

/** Formats minutes-since-midnight as "HH:MM", e.g. 1110 -> "18:30". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export interface NextClass {
  dayIndex: number;
  block: ScheduleBlock;
}

/**
 * Whether the class is running at `nowMinutes`. The end minute counts as over,
 * not still going: SIGAA's slots are back to back (N1 ends at 19:25 and N2
 * starts at 19:25), so at 19:25 the class that matters is the next one.
 */
export function isClassInProgress(block: ScheduleBlock, nowMinutes: number): boolean {
  return nowMinutes >= block.inicioMin && nowMinutes < block.fimMin;
}

/**
 * A wait in minutes as a badge-sized label: "em 40 min", "em 2h", "em 2h15".
 * Minutes are padded past the hour mark so 125 reads "em 2h05", never "em 2h5".
 */
export function formatMinutesUntil(minutes: number): string {
  if (minutes < 60) {
    return `em ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `em ${hours}h` : `em ${hours}h${String(rest).padStart(2, "0")}`;
}

/**
 * Finds the class to put in front of the student: the one running right now if
 * there is one, otherwise the next to start — scanning forward from
 * `todayIndex` (inclusive) through the rest of the week and wrapping back to
 * Monday.
 *
 * Today's classes are kept until their end minute, not their start, so a class
 * in progress stays the answer while it runs. Every other day's classes are all
 * still ahead relative to now.
 */
export function pickNextClass(
  week: ScheduleBlock[][],
  todayIndex: number,
  nowMinutes: number,
): NextClass | null {
  for (let offset = 0; offset < week.length; offset += 1) {
    const dayIndex = (todayIndex + offset) % week.length;
    const candidates =
      offset === 0 ? week[dayIndex].filter((b) => b.fimMin > nowMinutes) : week[dayIndex];

    if (candidates.length > 0) {
      return { dayIndex, block: candidates[0] };
    }
  }

  return null;
}
