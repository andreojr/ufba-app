import {
  buildWeekSchedule,
  formatMinutes,
  getCurrentWeekDays,
  pickNextClass,
  WEEKDAY_NAMES,
} from "./sigaa-schedule";
import type { Turma } from "./types";

describe("formatMinutes", () => {
  it("formats minutes-since-midnight as HH:MM", () => {
    expect(formatMinutes(1110)).toBe("18:30");
    expect(formatMinutes(420)).toBe("07:00");
    expect(formatMinutes(0)).toBe("00:00");
  });
});

describe("getCurrentWeekDays", () => {
  it("returns Monday–Friday of the current week, marking today", () => {
    // 2026-08-19 is a Wednesday
    const wednesday = new Date(2026, 7, 19, 10, 0, 0);

    const days = getCurrentWeekDays(wednesday);

    expect(days.map((d) => d.dayName)).toEqual(WEEKDAY_NAMES);
    expect(days.map((d) => d.num)).toEqual(["17", "18", "19", "20", "21"]);
    expect(days.map((d) => d.label)).toEqual(["Seg", "Ter", "Qua", "Qui", "Sex"]);
    expect(days[2].full).toBe("Quarta, 19 de agosto");
    expect(days.map((d) => d.isToday)).toEqual([false, false, true, false, false]);
  });

  it("rolls back to the same week's Monday when today is Sunday", () => {
    // 2026-08-23 is a Sunday; the week's Monday is 2026-08-17
    const sunday = new Date(2026, 7, 23, 10, 0, 0);

    const days = getCurrentWeekDays(sunday);

    expect(days.map((d) => d.num)).toEqual(["17", "18", "19", "20", "21"]);
    expect(days.every((d) => !d.isToday)).toBe(true);
  });
});

const TURMAS: Turma[] = [
  {
    codigo: "MATA37",
    nome: "SISTEMAS OPERACIONAIS",
    slots: [
      {
        dia: "Terça",
        inicioMin: 1110,
        fimMin: 1220,
        predio: "PAF 1",
        sala: "208",
        localOriginal: "PAF 1 - 208 - Terça Horários 18:30 às 19:25",
      },
      {
        dia: "Quinta",
        inicioMin: 1110,
        fimMin: 1220,
        predio: "PAF 1",
        sala: "208",
        localOriginal: "PAF 1 - 208 - Quinta Horários 18:30 às 19:25",
      },
    ],
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
  },
  {
    codigo: "MATA48",
    nome: "REDES DE COMPUTADORES I",
    slots: [
      {
        dia: "Terça",
        inicioMin: 420,
        fimMin: 475,
        predio: "PAF I",
        sala: null,
        localOriginal: "Ter PAF I/Qui Smart Class III",
      },
    ],
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
  },
  {
    codigo: null,
    nome: "ATIVIDADE DE SÁBADO",
    slots: [
      {
        dia: "Sábado",
        inicioMin: 480,
        fimMin: 540,
        predio: null,
        sala: null,
        localOriginal: "a combinar",
      },
    ],
    vigencia: { inicio: "19/08/2026", fim: "19/12/2026" },
    semestre: "2026.2",
  },
];

describe("buildWeekSchedule", () => {
  it("groups slots by weekday (Monday–Friday only) and sorts each day by start time", () => {
    const week = buildWeekSchedule(TURMAS);

    expect(week).toHaveLength(5);
    // Segunda (index 0): nothing scheduled
    expect(week[0]).toEqual([]);
    // Terça (index 1): both turmas, sorted by inicioMin ascending
    expect(week[1].map((b) => b.codigo)).toEqual(["MATA48", "MATA37"]);
    // Quinta (index 3): only MATA37
    expect(week[3].map((b) => b.codigo)).toEqual(["MATA37"]);
  });

  it("drops Sábado slots (out of scope for the weekly grid)", () => {
    const week = buildWeekSchedule(TURMAS);
    const allCodes = week.flat().map((b) => b.codigo);

    expect(allCodes).not.toContain(null);
  });

  it("assigns each distinct course a stable color index by first appearance", () => {
    const week = buildWeekSchedule(TURMAS);
    const redes = week[1].find((b) => b.codigo === "MATA48");
    const sistemas = week[1].find((b) => b.codigo === "MATA37");

    expect(redes?.colorIndex).toBe(0);
    expect(sistemas?.colorIndex).toBe(1);
  });
});

describe("pickNextClass", () => {
  it("picks the next class later today when one exists", () => {
    const week = buildWeekSchedule(TURMAS);

    // today = Terça (index 1), now = 10:00 (600 min) — MATA48 (7:00) already passed,
    // MATA37 (18:30) is still ahead
    const result = pickNextClass(week, 1, 600);

    expect(result?.dayIndex).toBe(1);
    expect(result?.block.codigo).toBe("MATA37");
  });

  it("skips to the next day with a class when nothing remains today", () => {
    const week = buildWeekSchedule(TURMAS);

    // today = Terça (index 1), now = 23:00 (1380 min) — nothing left today;
    // next class is Quinta's MATA37
    const result = pickNextClass(week, 1, 1380);

    expect(result?.dayIndex).toBe(3);
    expect(result?.block.codigo).toBe("MATA37");
  });

  it("wraps around to Monday of next week when nothing remains this week", () => {
    const week = buildWeekSchedule(TURMAS);

    // today = Sexta (index 4), nothing scheduled after it this week
    const result = pickNextClass(week, 4, 0);

    expect(result?.dayIndex).toBe(1);
    expect(result?.block.codigo).toBe("MATA48");
  });

  it("returns null when there are no classes at all", () => {
    const result = pickNextClass([[], [], [], [], []], 0, 0);

    expect(result).toBeNull();
  });
});
