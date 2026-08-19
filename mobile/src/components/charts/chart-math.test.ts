import { dominioComMargem, escalaLinear, posicoesX } from "./chart-math";

describe("dominioComMargem", () => {
  it("pads the series' own min and max rather than a fixed scale", () => {
    // A CR series barely moves between 7.9 and 8.1 — padding a fixed 0–10
    // scale would flatten it to a near-straight line.
    const { min, max } = dominioComMargem([7.9, 8.0, 8.1], 0.1);
    expect(min).toBeCloseTo(7.88);
    expect(max).toBeCloseTo(8.12);
  });

  it("still returns a non-zero range when every value is identical", () => {
    // Otherwise escalaLinear would divide by zero.
    const { min, max } = dominioComMargem([8, 8, 8], 0.1);
    expect(max).toBeGreaterThan(min);
  });

  it("returns a zero-width domain around zero for an empty series", () => {
    expect(dominioComMargem([], 0.1)).toEqual({ min: -0.5, max: 0.5 });
  });
});

describe("escalaLinear", () => {
  it("maps the domain's max to the top (y = 0) and min to the bottom (y = altura), no margin", () => {
    const escala = escalaLinear({ min: 0, max: 10 }, 100, 0);
    expect(escala(10)).toBe(0);
    expect(escala(0)).toBe(100);
    expect(escala(5)).toBe(50);
  });

  it("insets both ends by margem, leaving room for a floating label above the highest point", () => {
    const escala = escalaLinear({ min: 0, max: 10 }, 100, 20);
    expect(escala(10)).toBe(20);
    expect(escala(0)).toBe(80);
    expect(escala(5)).toBe(50);
  });

  it("centers every value when the domain has no width", () => {
    const escala = escalaLinear({ min: 8, max: 8 }, 100, 20);
    expect(escala(8)).toBe(50);
  });
});

describe("posicoesX", () => {
  it("spreads points evenly from edge to edge, no margin", () => {
    expect(posicoesX(3, 100, 0)).toEqual([0, 50, 100]);
  });

  it("insets both ends by margem", () => {
    expect(posicoesX(3, 100, 10)).toEqual([10, 50, 90]);
  });

  it("centers a single point regardless of margem", () => {
    expect(posicoesX(1, 100, 10)).toEqual([50]);
  });

  it("returns nothing for an empty series", () => {
    expect(posicoesX(0, 100, 10)).toEqual([]);
  });
});
