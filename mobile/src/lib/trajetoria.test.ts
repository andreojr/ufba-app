import {
  agruparPorSemestre,
  formatarCoeficiente,
  formatarNota,
  historicoDesatualizado,
  percentualConcluido,
  poolPlanejavel,
  rotuloSituacao,
  zonasDePlanejamento,
} from "./trajetoria";
import type { ComponenteCursado, ComponentePendente } from "./types";

function componente(over: Partial<ComponenteCursado> = {}): ComponenteCursado {
  return {
    semestre: "2025.1",
    natureza: "OB",
    codigo: "MATA37",
    nome: "INTRODUÇÃO À LÓGICA",
    cargaHoraria: 60,
    nota: 8.7,
    situacao: "APR",
    docente: null,
    ...over,
  };
}

describe("agruparPorSemestre", () => {
  it("groups components by term, oldest first", () => {
    const periodos = agruparPorSemestre([
      componente({ semestre: "2025.2", codigo: "MATA40" }),
      componente({ semestre: "2025.1", codigo: "MATA37" }),
    ]);

    expect(periodos.map((p) => p.semestre)).toEqual(["2025.1", "2025.2"]);
  });

  it("marks the term holding an enrolled component as the current one", () => {
    const periodos = agruparPorSemestre([
      componente({ semestre: "2025.1" }),
      componente({ semestre: "2026.2", situacao: "MATR", nota: null }),
    ]);

    expect(periodos.map((p) => p.emCurso)).toEqual([false, true]);
  });
});

describe("percentualConcluido", () => {
  it("divides integralised by required hours, both totals", () => {
    // Optativa and complementary hours are in the denominator: that is exactly
    // how those 360h "count" while no optativa is listed individually.
    expect(percentualConcluido({ exigida: 3610, integralizada: 2100, pendente: 1510 })).toBe(58);
  });

  it("reports zero rather than NaN when nothing is required yet", () => {
    expect(percentualConcluido({ exigida: 0, integralizada: 0, pendente: 0 })).toBe(0);
  });
});

describe("formatarNota", () => {
  it("renders the transcript's decimal point as a comma", () => {
    expect(formatarNota(8.7)).toBe("8,7");
    expect(formatarNota(10)).toBe("10,0");
  });

  it("renders a missing grade as an em dash", () => {
    expect(formatarNota(null)).toBe("—");
  });
});

describe("formatarCoeficiente", () => {
  it("keeps two decimals, not the grade formatter's one", () => {
    // The transcript prints the CR at four decimals (8.1597). One decimal
    // would round it to 8,2 and throw away a digit students compare against
    // their own arithmetic; four is noise on a summary card.
    expect(formatarCoeficiente(8.1597)).toBe("8,16");
    expect(formatarCoeficiente(10)).toBe("10,00");
  });

  it("renders an absent coefficient as an em dash", () => {
    expect(formatarCoeficiente(null)).toBe("—");
  });
});

describe("rotuloSituacao", () => {
  it("has no label for an approved component, which needs no chip", () => {
    expect(rotuloSituacao("APR")).toBeNull();
  });

  it("labels every situação that changes how a grade should be read", () => {
    expect(rotuloSituacao("REP")).toBe("reprovado");
    expect(rotuloSituacao("REPF")).toBe("reprovado por falta");
    expect(rotuloSituacao("TRANC")).toBe("trancado");
    expect(rotuloSituacao("MATR")).toBe("em curso");
    expect(rotuloSituacao("DISP")).toBe("dispensado");
  });

  it("falls back to the raw code for a situação the legend gained later", () => {
    expect(rotuloSituacao("XPTO")).toBe("XPTO");
  });
});

describe("poolPlanejavel", () => {
  const pendentes: ComponentePendente[] = [
    { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 60, matriculado: false },
    { codigo: "MATA59", nome: "REDES", cargaHoraria: 60, matriculado: true },
    { codigo: "ENADE", nome: "ENADE", cargaHoraria: 0, matriculado: false },
  ];

  it("drops components already being taken and the ENADE rows", () => {
    // ENADE is not a curricular component, and something already enrolled is
    // not something to plan.
    expect(poolPlanejavel(pendentes).map((p) => p.codigo)).toEqual(["MATA60"]);
  });
});

describe("zonasDePlanejamento", () => {
  it("offers the terms after the current one, bounded by the deadline", () => {
    // The transcript states the deadline; planning past it is not a plan.
    expect(zonasDePlanejamento("2026.2", "2027.2", 4)).toEqual([
      "2027.1",
      "2027.2",
    ]);
  });

  it("counts 2 to 1 across the year boundary", () => {
    expect(zonasDePlanejamento("2025.2", "2030.1", 3)).toEqual([
      "2026.1",
      "2026.2",
      "2027.1",
    ]);
  });

  it("returns nothing when the current term is already the deadline", () => {
    expect(zonasDePlanejamento("2030.1", "2030.1", 4)).toEqual([]);
  });
});

describe("historicoDesatualizado", () => {
  const fim = "2026-07-15";
  const emCurso = [componente({ semestre: "2026.1", situacao: "MATR", nota: null })];
  const consolidado = [componente({ semestre: "2026.1", situacao: "APR", nota: 7 })];

  it("flags a term that has ended while components are still in progress", () => {
    // Both conditions together: grades that have yet to land (MATR), and a term
    // already over, so they should have landed by now.
    expect(historicoDesatualizado(emCurso, fim, new Date("2026-08-19"))).toBe(true);
  });

  it("stays quiet while the term is still running", () => {
    // MATR is true all semester. On its own it is a permanent banner, and a
    // permanent banner is one the student stops seeing.
    expect(historicoDesatualizado(emCurso, fim, new Date("2026-07-01"))).toBe(false);
  });

  it("stays quiet once every component is consolidated", () => {
    expect(historicoDesatualizado(consolidado, fim, new Date("2026-08-19"))).toBe(false);
  });

  it("stays quiet when the term's end date is unknown", () => {
    // No cached date, or a portal that reported a term without one: say nothing
    // rather than guess.
    expect(historicoDesatualizado(emCurso, null, new Date("2026-08-19"))).toBe(false);
  });
});
