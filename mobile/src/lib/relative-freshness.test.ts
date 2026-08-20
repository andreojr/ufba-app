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
});
