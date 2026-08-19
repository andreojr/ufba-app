import { describePeriodo, isWithinPeriodo, parseIsoDate } from "./periodo-letivo";
import type { PeriodoLetivo } from "./types";

const PERIODO: PeriodoLetivo = {
  semestre: "2026.2",
  inicio: "2026-08-19",
  fim: "2026-12-19",
};

/** Local noon, so a timezone slip would have to be >12h to change the day. */
function at(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("parseIsoDate", () => {
  it("reads an ISO date as a local calendar day", () => {
    const date = parseIsoDate("2026-08-19");

    // new Date("2026-08-19") would be UTC midnight, which is still the 18th in
    // Brazil — the whole schedule would shift a day west of Greenwich.
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(19);
  });
});

describe("describePeriodo", () => {
  it("counts down to the start before the term begins", () => {
    const status = describePeriodo(PERIODO, at(2026, 8, 12));

    expect(status.phase).toBe("antes");
    expect(status.countdown).toBe("começa em 7 dias");
  });

  it('says "começa amanhã" on the eve of the first day', () => {
    const status = describePeriodo(PERIODO, at(2026, 8, 18));

    expect(status.phase).toBe("antes");
    expect(status.countdown).toBe("começa amanhã");
  });

  it("reports no progress before the term begins", () => {
    const status = describePeriodo(PERIODO, at(2026, 8, 12));

    expect(status.progress).toBe(0);
  });

  it('treats the first day as under way, and says so', () => {
    const status = describePeriodo(PERIODO, at(2026, 8, 19));

    expect(status.phase).toBe("curso");
    expect(status.countdown).toBe("começa hoje");
    expect(status.progress).toBe(0);
  });

  it("counts down to the end once the term is under way", () => {
    const status = describePeriodo(PERIODO, at(2026, 10, 10));

    expect(status.phase).toBe("curso");
    expect(status.countdown).toBe("faltam 70 dias");
  });

  it("reports how much of the term has elapsed", () => {
    // 2026-08-19 to 2026-12-19 is 122 days; 2026-10-10 is day 52 of it.
    const status = describePeriodo(PERIODO, at(2026, 10, 10));

    expect(status.progress).toBeCloseTo(52 / 122, 4);
  });

  it('says "termina amanhã" on the eve of the last day', () => {
    const status = describePeriodo(PERIODO, at(2026, 12, 18));

    expect(status.countdown).toBe("termina amanhã");
  });

  it('says "último dia" on the closing day, which is still under way', () => {
    const status = describePeriodo(PERIODO, at(2026, 12, 19));

    expect(status.phase).toBe("curso");
    expect(status.countdown).toBe("último dia");
    expect(status.progress).toBe(1);
  });

  it("reports the term as over the day after it closes", () => {
    const status = describePeriodo(PERIODO, at(2026, 12, 20));

    expect(status.phase).toBe("encerrado");
    expect(status.countdown).toBe("período encerrado");
    expect(status.progress).toBe(1);
  });

  it("labels the ends of the track with the abbreviated months", () => {
    const status = describePeriodo(PERIODO, at(2026, 10, 10));

    expect(status.inicioLabel).toBe("ago");
    expect(status.fimLabel).toBe("dez");
  });
});

describe("isWithinPeriodo", () => {
  it("counts the first and last days as inside the term", () => {
    expect(isWithinPeriodo(at(2026, 8, 19), PERIODO)).toBe(true);
    expect(isWithinPeriodo(at(2026, 12, 19), PERIODO)).toBe(true);
  });

  it("rejects the day before the term starts", () => {
    // The bug this fixes: a Monday the 17th showing Monday's classes when the
    // term only starts on Wednesday the 19th.
    expect(isWithinPeriodo(at(2026, 8, 17), PERIODO)).toBe(false);
  });

  it("rejects the day after the term ends", () => {
    expect(isWithinPeriodo(at(2026, 12, 20), PERIODO)).toBe(false);
  });

  it("accepts any day at all times of day, not just at noon", () => {
    expect(isWithinPeriodo(new Date(2026, 7, 19, 0, 0, 0), PERIODO)).toBe(true);
    expect(isWithinPeriodo(new Date(2026, 7, 19, 23, 59, 59), PERIODO)).toBe(true);
    expect(isWithinPeriodo(new Date(2026, 7, 18, 23, 59, 59), PERIODO)).toBe(false);
  });
});
