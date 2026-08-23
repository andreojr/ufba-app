import {
  buildWeekSchedule,
  formatMinutes,
  formatMinutesUntil,
  getCurrentWeekDays,
  GRID_TIME_MARKS,
  isClassInProgress,
  maskWeekToPeriodo,
  pickNextClass,
  SCHEDULE_END_MIN,
  SCHEDULE_START_MIN,
  type ScheduleBlock,
  WEEKDAY_NAMES,
} from "./sigaa-schedule";
import type { PeriodoLetivo, Turma } from "./types";

describe("grid time marks", () => {
  it("spans the first slot's start through the last slot's end", () => {
    expect(SCHEDULE_START_MIN).toBe(420); // M1 opens at 07:00
    expect(SCHEDULE_END_MIN).toBe(1330); // N4 closes at 22:10
  });

  it("marks the end of every second slot, since classes are scheduled in pairs", () => {
    // A "2N34" is N3+N4 back to back, so pair boundaries are where a student's
    // day actually breaks — round clock hours fall mid-class.
    expect(GRID_TIME_MARKS.map(formatMinutes)).toEqual([
      "08:50",
      "10:40",
      "12:30",
      "14:50",
      "16:40",
      "18:30",
      "20:20",
      "22:10",
    ]);
  });

  it("skips 13:00, because counting in pairs across the lunch break lands on 14:50", () => {
    expect(GRID_TIME_MARKS).not.toContain(780);
    expect(GRID_TIME_MARKS).toContain(890);
  });

  it("keeps every mark inside the grid it is drawn on", () => {
    for (const mark of GRID_TIME_MARKS) {
      expect(mark).toBeGreaterThanOrEqual(SCHEDULE_START_MIN);
      expect(mark).toBeLessThanOrEqual(SCHEDULE_END_MIN);
    }
  });

  it("orders the marks so they can be laid out top to bottom without sorting", () => {
    const ascending = [...GRID_TIME_MARKS].sort((a, b) => a - b);

    expect(GRID_TIME_MARKS).toEqual(ascending);
  });
});

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

  it("rolls forward to next week's Monday when today is Saturday", () => {
    // 2026-08-22 is a Saturday; the week ahead starts 2026-08-24
    const saturday = new Date(2026, 7, 22, 10, 0, 0);

    const days = getCurrentWeekDays(saturday);

    expect(days.map((d) => d.num)).toEqual(["24", "25", "26", "27", "28"]);
    expect(days.every((d) => !d.isToday)).toBe(true);
  });

  it("rolls forward to next week's Monday when today is Sunday", () => {
    // 2026-08-23 is a Sunday; the week ahead starts 2026-08-24
    const sunday = new Date(2026, 7, 23, 10, 0, 0);

    const days = getCurrentWeekDays(sunday);

    expect(days.map((d) => d.num)).toEqual(["24", "25", "26", "27", "28"]);
    expect(days.every((d) => !d.isToday)).toBe(true);
  });

  it("exposes each day's own date, so callers can place it inside the term", () => {
    const wednesday = new Date(2026, 7, 19, 10, 0, 0);

    const days = getCurrentWeekDays(wednesday);

    expect(days.map((d) => d.date.getDate())).toEqual([17, 18, 19, 20, 21]);
    expect(days[0].date.getMonth()).toBe(7);
    expect(days[0].date.getFullYear()).toBe(2026);
  });
});

const TURMAS: Turma[] = [
  {
    id: "turma-1",
    numero: "01",
    codigo: "MATA37",
    nome: "SISTEMAS OPERACIONAIS",
    docente: null,
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
    id: "turma-2",
    numero: "02",
    codigo: "MATA48",
    nome: "REDES DE COMPUTADORES I",
    docente: null,
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
    id: "turma-3",
    numero: "03",
    codigo: null,
    nome: "ATIVIDADE DE SÁBADO",
    docente: null,
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

describe("maskWeekToPeriodo", () => {
  const PERIODO: PeriodoLetivo = {
    semestre: "2026.2",
    inicio: "2026-08-19",
    fim: "2026-12-19",
  };
  // 2026-08-19 is a Wednesday, so this week runs Mon 17 → Fri 21 and the term
  // starts mid-week: Monday and Tuesday are before it.
  const days = getCurrentWeekDays(new Date(2026, 7, 19, 10, 0, 0));

  it("empties the days that fall before the term starts", () => {
    const week = buildWeekSchedule(TURMAS);

    const masked = maskWeekToPeriodo(week, days, PERIODO);

    // Terça is the 18th here — a day before the term opens, so both of its
    // classes have to go.
    expect(masked[1]).toEqual([]);
  });

  it("keeps the days that fall inside the term", () => {
    const week = buildWeekSchedule(TURMAS);

    const masked = maskWeekToPeriodo(week, days, PERIODO);

    // Quinta the 20th is inside the term and keeps its class
    expect(masked[3].map((b) => b.codigo)).toEqual(["MATA37"]);
  });

  it("leaves the week untouched when there is no periodo letivo to mask against", () => {
    const week = buildWeekSchedule(TURMAS);

    expect(maskWeekToPeriodo(week, days, null)).toEqual(week);
  });

  it("keeps pickNextClass from pointing at a day before the term started", () => {
    // The actual bug: with Segunda/Terça still populated, the "próxima aula"
    // card advertised a class on a day the semester hadn't reached yet.
    const week = maskWeekToPeriodo(buildWeekSchedule(TURMAS), days, PERIODO);

    const next = pickNextClass(week, 1, 0);

    expect(next?.dayIndex).toBe(3);
  });
});

describe("isClassInProgress", () => {
  const block = { inicioMin: 480, fimMin: 540 } as ScheduleBlock;

  it("is true between the start and the end", () => {
    expect(isClassInProgress(block, 500)).toBe(true);
  });

  it("is true at the exact minute the class starts", () => {
    expect(isClassInProgress(block, 480)).toBe(true);
  });

  it("is false before it starts", () => {
    expect(isClassInProgress(block, 479)).toBe(false);
  });

  it("is false once the end minute is reached, so it does not overlap the next slot", () => {
    // Slots are back to back (N1 ends at 19:25, N2 starts at 19:25), so the end
    // minute belongs to the following class.
    expect(isClassInProgress(block, 540)).toBe(false);
  });
});

describe("formatMinutesUntil", () => {
  it("counts minutes under an hour", () => {
    expect(formatMinutesUntil(40)).toBe("em 40 min");
  });

  it("counts a single minute without pluralizing", () => {
    expect(formatMinutesUntil(1)).toBe("em 1 min");
  });

  it("drops the minutes when it lands on a whole hour", () => {
    expect(formatMinutesUntil(120)).toBe("em 2h");
  });

  it("keeps hours and minutes compact enough for a badge", () => {
    expect(formatMinutesUntil(135)).toBe("em 2h15");
  });

  it("pads the minutes so 2h05 does not read as 2h5", () => {
    expect(formatMinutesUntil(125)).toBe("em 2h05");
  });
});

describe("pickNextClass", () => {
  it("picks a class that is happening right now, not only ones still to come", () => {
    // Without this the card can never say "Agora": the only class it would ever
    // offer for today is one that hasn't started.
    const week = buildWeekSchedule(TURMAS);

    // today = Terça (index 1), now = 07:30 (450 min) — MATA48 runs 07:00–07:55
    const result = pickNextClass(week, 1, 450);

    expect(result?.block.codigo).toBe("MATA48");
    expect(isClassInProgress(result!.block, 450)).toBe(true);
  });

  it("drops a class the moment it ends", () => {
    const week = buildWeekSchedule(TURMAS);

    // MATA48 ends at 475; at 475 the next one up is MATA37 at 18:30
    const result = pickNextClass(week, 1, 475);

    expect(result?.block.codigo).toBe("MATA37");
  });

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
