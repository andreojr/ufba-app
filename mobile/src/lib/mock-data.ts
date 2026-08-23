/**
 * Mock data for the UFBA UI screens.
 *
 * Ported from the `Gradline App.dc.html` Claude Design mockup (historical file name). Everything here is
 * static/fake data used to drive the front-end mockup — there is no backend behind it.
 */

export type CourseCode = "MATA55" | "MATA62" | "MATA64";

export const COURSE_COLORS: Record<CourseCode, { fill: string; fg: string; bar: string }> = {
  MATA55: { fill: "rgba(139,92,246,0.22)", fg: "#A78BFA", bar: "#7C3AED" },
  MATA62: { fill: "rgba(23,201,100,0.15)", fg: "#5BD891", bar: "#17C964" },
  MATA64: { fill: "rgba(247,183,80,0.15)", fg: "#F8CE8C", bar: "#F7B750" },
};

export type ScheduleEntry = {
  start: number;
  end: number;
  code: CourseCode;
  name: string;
  room: string;
};

/** One list of classes per weekday (Mon–Fri). */
export const SCHEDULE: ScheduleEntry[][] = [
  [
    { start: 8, end: 10, code: "MATA55", name: "Sistemas operacionais", room: "PAF I, sala 12" },
    { start: 14, end: 16, code: "MATA64", name: "Redes de computadores", room: "IME, sala 201" },
  ],
  [
    {
      start: 10,
      end: 12,
      code: "MATA62",
      name: "Engenharia de software I",
      room: "PAF III, sala 03",
    },
  ],
  [
    { start: 8, end: 10, code: "MATA55", name: "Sistemas operacionais", room: "PAF I, sala 12" },
    { start: 18, end: 20, code: "MATA64", name: "Redes — laboratório", room: "LabTec, sala 05" },
  ],
  [
    {
      start: 10,
      end: 12,
      code: "MATA62",
      name: "Engenharia de software I",
      room: "PAF III, sala 03",
    },
    { start: 14, end: 16, code: "MATA64", name: "Redes de computadores", room: "IME, sala 201" },
  ],
  [
    {
      start: 16,
      end: 18,
      code: "MATA62",
      name: "Engenharia de software — prática",
      room: "PAF III, sala 03",
    },
  ],
];

export const DAYS = [
  { key: "0", label: "Seg", num: "17", full: "Segunda, 17 de agosto" },
  { key: "1", label: "Ter", num: "18", full: "Terça, 18 de agosto" },
  { key: "2", label: "Qua", num: "19", full: "Quarta, 19 de agosto" },
  { key: "3", label: "Qui", num: "20", full: "Quinta, 20 de agosto" },
  { key: "4", label: "Sex", num: "21", full: "Sexta, 21 de agosto" },
] as const;

export const HOURS = [8, 10, 12, 14, 16, 18, 20];

/** Grid geometry used to position schedule blocks absolutely. */
export const SCHEDULE_GRID_HEIGHT = 216;
export const SCHEDULE_PX_PER_HOUR = 18;

export type DocumentKey = "atestado" | "historico";

export const DOCUMENT_DEFS: Record<
  DocumentKey,
  { title: string; description: string; tint: string; fg: string }
> = {
  atestado: {
    title: "Atestado de matrícula",
    description: "Comprova que você está matriculada em 2026.1",
    tint: "rgba(139,92,246,0.22)",
    fg: "#A78BFA",
  },
  historico: {
    title: "Histórico escolar",
    description: "Todas as notas e a carga horária cursada",
    tint: "rgba(247,183,80,0.15)",
    fg: "#F8CE8C",
  },
};

/** Formats an hour (0-23) as "0Xh00" the way the design does. */
export function formatHour(hour: number): string {
  return `${hour < 10 ? "0" + hour : hour}h00`;
}

/** Grade color by score threshold, matching the design's rules. */
export function gradeColor(grade: string): string {
  const value = Number.parseFloat(grade.replace(",", "."));
  if (Number.isNaN(value)) return "#A1A1AA";
  if (value >= 7) return "#5BD891";
  if (value >= 5) return "#F8CE8C";
  return "#E76964";
}
