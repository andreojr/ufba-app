import type { Turma } from "./types";

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
    };
  });
}

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
 * Finds the next upcoming class, scanning forward from `todayIndex`
 * (inclusive) through the rest of the week and wrapping back to Monday.
 * Today's classes that already started are excluded; every other day's
 * classes are all still "upcoming" relative to now.
 */
export function pickNextClass(
  week: ScheduleBlock[][],
  todayIndex: number,
  nowMinutes: number,
): NextClass | null {
  for (let offset = 0; offset < week.length; offset += 1) {
    const dayIndex = (todayIndex + offset) % week.length;
    const candidates =
      offset === 0 ? week[dayIndex].filter((b) => b.inicioMin > nowMinutes) : week[dayIndex];

    if (candidates.length > 0) {
      return { dayIndex, block: candidates[0] };
    }
  }

  return null;
}
