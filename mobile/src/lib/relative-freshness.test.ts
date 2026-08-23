import { relativeFreshness } from "./relative-freshness";

describe("relativeFreshness", () => {
  it("says 'agora mesmo' for anything that rounds to under a minute", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-19T10:00:20Z");

    expect(relativeFreshness(loadedAt, now)).toBe("agora mesmo");
  });

  it("uses the singular for exactly one minute", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-19T10:01:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 1 min");
  });

  it("uses the plural for more than one minute", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-19T10:05:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 5 min");
  });

  it("never reports a negative age when the clock is slightly behind", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-19T09:59:59Z");

    expect(relativeFreshness(loadedAt, now)).toBe("agora mesmo");
  });

  it("switches to hours past 59 minutes, using the singular for exactly one", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-19T11:00:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 1 hora");
  });

  it("uses the plural for more than one hour, rounded rather than left in minutes", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-20T06:03:00Z"); // 20h03 → 1203 min, the case that used to leak through

    expect(relativeFreshness(loadedAt, now)).toBe("há 20 horas");
  });

  it("switches to days past 23 hours, using the singular for exactly one", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-20T10:00:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 1 dia");
  });

  it("uses the plural for more than one day", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-08-22T10:00:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 3 dias");
  });

  it("switches to months past 29 days, using the singular for exactly one", () => {
    const loadedAt = new Date("2026-08-19T10:00:00Z");
    const now = new Date("2026-09-18T10:00:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 1 mês");
  });

  it("switches to years past 11 months, using the singular for exactly one", () => {
    const loadedAt = new Date("2025-08-19T10:00:00Z");
    const now = new Date("2026-08-19T10:00:00Z");

    expect(relativeFreshness(loadedAt, now)).toBe("há 1 ano");
  });
});
