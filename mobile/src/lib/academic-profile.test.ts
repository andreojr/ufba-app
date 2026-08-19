import { countSemestresNaUfba, formatCursoNome, formatTempoNaUfba } from "./academic-profile";

describe("formatCursoNome", () => {
  it("keeps only the course name before the slash", () => {
    expect(formatCursoNome("ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador")).toBe(
      "ENGENHARIA DE COMPUTAÇÃO",
    );
  });

  it("drops unit, city, modality and shift details after the slash", () => {
    expect(
      formatCursoNome("CIÊNCIA DA COMPUTAÇÃO/IC - SALVADOR - Presencial - MT - BACHARELADO"),
    ).toBe("CIÊNCIA DA COMPUTAÇÃO");
  });

  it("returns the trimmed name unchanged when there is no slash", () => {
    expect(formatCursoNome("  MEDICINA ")).toBe("MEDICINA");
  });
});

describe("formatTempoNaUfba", () => {
  it("shows the ordinal of the in-progress semester, not an elapsed count", () => {
    // Someone who entered 2023.1 is *starting* their 8th semester in 2026.2 —
    // "Há 8 semestres" read as 8 finished semesters, which was misleading.
    expect(formatTempoNaUfba(8)).toBe("8º semestre");
  });

  it("works for the very first semester", () => {
    expect(formatTempoNaUfba(1)).toBe("1º semestre");
  });
});

describe("countSemestresNaUfba", () => {
  it("counts inclusive semesters from ingresso to the current semester", () => {
    // 2022.1 → 2026.2 = 2022.1, 2022.2, ..., 2026.2 = 10 semesters
    expect(countSemestresNaUfba("2022.1", new Date("2026-08-19"))).toBe(10);
  });

  it("returns 1 during the very first semester", () => {
    expect(countSemestresNaUfba("2026.2", new Date("2026-08-19"))).toBe(1);
  });

  it("treats January–June as the .1 semester", () => {
    expect(countSemestresNaUfba("2026.1", new Date("2026-03-10"))).toBe(1);
    expect(countSemestresNaUfba("2025.2", new Date("2026-03-10"))).toBe(2);
  });

  it("returns null for a malformed período", () => {
    expect(countSemestresNaUfba("indefinida", new Date("2026-08-19"))).toBeNull();
    expect(countSemestresNaUfba(null, new Date("2026-08-19"))).toBeNull();
    expect(countSemestresNaUfba(undefined, new Date("2026-08-19"))).toBeNull();
  });

  it("returns null for an ingresso in the future", () => {
    expect(countSemestresNaUfba("2027.1", new Date("2026-08-19"))).toBeNull();
  });
});
