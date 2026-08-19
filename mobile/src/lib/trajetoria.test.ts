import {
  agruparPorAno,
  agruparPorSemestre,
  calcularCrAcumulado,
  formatarCoeficiente,
  formatarImpacto,
  formatarNota,
  historicoDesatualizado,
  impactoNoCr,
  percentualConcluido,
  poolPlanejavel,
  rotuloSituacao,
  somarCargaHoraria,
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
    // 586/1000 = 58.6%, chosen so floor/trunc (58) and round (59) disagree —
    // 3610/2100 would pass under any of the three, so it did not actually pin
    // which one percentualConcluido uses.
    expect(percentualConcluido({ exigida: 1000, integralizada: 586, pendente: 414 })).toBe(59);
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

  // Both boundaries chosen so a bare `new Date(fimDoPeriodo)` — reading the
  // ISO string as UTC midnight — would flip the answer on at least one of
  // them, unlike the cases above, which sit a month from the boundary and
  // pass identically whichever way `fim` is built. Built with the explicit
  // Date constructor (year, month, day, hour, minute), never a datetime
  // string, so the test itself isn't the thing silently depending on the
  // runner's timezone.
  it("stays quiet up to the last moment of the term's final day", () => {
    // 23:00 on 2026-07-15: the term's own last day, per periodo-letivo's
    // "both boundaries inclusive" rule — still "curso", not yet stale.
    expect(historicoDesatualizado(emCurso, fim, new Date(2026, 6, 15, 23, 0))).toBe(false);
  });

  it("flags the term stale from the first moment after it ends", () => {
    // 00:30 on 2026-07-16: one calendar day past `fim`.
    expect(historicoDesatualizado(emCurso, fim, new Date(2026, 6, 16, 0, 30))).toBe(true);
  });
});

describe("agruparPorAno", () => {
  it("groups periods by the year in their semestre, oldest first", () => {
    const anos = agruparPorAno([
      { semestre: "2025.1", emCurso: false, componentes: [] },
      { semestre: "2025.2", emCurso: false, componentes: [] },
      { semestre: "2026.1", emCurso: true, componentes: [] },
    ]);

    expect(anos.map((a) => a.ano)).toEqual(["2025", "2026"]);
    expect(anos[0].periodos.map((p) => p.semestre)).toEqual(["2025.1", "2025.2"]);
    expect(anos[1].periodos.map((p) => p.semestre)).toEqual(["2026.1"]);
  });

  it("keeps a lone period in its own year", () => {
    const anos = agruparPorAno([{ semestre: "2024.2", emCurso: false, componentes: [] }]);
    expect(anos).toEqual([{ ano: "2024", periodos: [{ semestre: "2024.2", emCurso: false, componentes: [] }] }]);
  });
});

describe("somarCargaHoraria", () => {
  it("sums the cargaHoraria of every component", () => {
    expect(
      somarCargaHoraria([componente({ cargaHoraria: 60 }), componente({ cargaHoraria: 68 })]),
    ).toBe(128);
  });

  it("returns zero for an empty period", () => {
    expect(somarCargaHoraria([])).toBe(0);
  });
});

describe("calcularCrAcumulado", () => {
  it("weights each term's grades by carga horária, same as the transcript's own CR", () => {
    const cursados = [
      componente({ semestre: "2025.1", codigo: "MATA37", cargaHoraria: 60, nota: 8 }),
      componente({ semestre: "2025.1", codigo: "MATA40", cargaHoraria: 60, nota: 6 }),
    ];
    const serie = calcularCrAcumulado(cursados, ["2025.1"]);
    expect(serie).toEqual([{ semestre: "2025.1", cr: 7 }]);
  });

  it("accumulates grades across terms rather than resetting each one", () => {
    const cursados = [
      componente({ semestre: "2025.1", codigo: "MATA37", cargaHoraria: 60, nota: 8 }),
      componente({ semestre: "2025.2", codigo: "MATA40", cargaHoraria: 60, nota: 6 }),
    ];
    const serie = calcularCrAcumulado(cursados, ["2025.1", "2025.2"]);
    expect(serie).toEqual([
      { semestre: "2025.1", cr: 8 },
      { semestre: "2025.2", cr: 7 },
    ]);
  });

  it("carries the previous value over a term with no graded component yet", () => {
    const cursados = [
      componente({ semestre: "2025.1", codigo: "MATA37", cargaHoraria: 60, nota: 8 }),
      componente({
        semestre: "2025.2",
        codigo: "MATA55",
        cargaHoraria: 68,
        nota: null,
        situacao: "MATR",
      }),
    ];
    const serie = calcularCrAcumulado(cursados, ["2025.1", "2025.2"]);
    expect(serie).toEqual([
      { semestre: "2025.1", cr: 8 },
      { semestre: "2025.2", cr: 8 },
    ]);
  });

  it("reports null while nothing has a grade yet", () => {
    const serie = calcularCrAcumulado([], ["2025.1"]);
    expect(serie).toEqual([{ semestre: "2025.1", cr: null }]);
  });
});

describe("impactoNoCr", () => {
  it("is positive when the component's grade sits above the CR without it", () => {
    const cursados = [
      componente({ codigo: "MATA37", cargaHoraria: 60, nota: 8 }),
      componente({ codigo: "MATA40", cargaHoraria: 60, nota: 6 }),
    ];
    // Full CR: 7. Without MATA37 (the 8): 6. Impact of MATA37: 7 - 6 = 1.
    expect(impactoNoCr(cursados, "MATA37")).toBeCloseTo(1);
  });

  it("is negative when the component's grade sits below the CR without it", () => {
    const cursados = [
      componente({ codigo: "MATA37", cargaHoraria: 60, nota: 8 }),
      componente({ codigo: "MATA40", cargaHoraria: 60, nota: 6 }),
    ];
    // Without MATA40 (the 6): 8. Impact of MATA40: 7 - 8 = -1.
    expect(impactoNoCr(cursados, "MATA40")).toBeCloseTo(-1);
  });

  it("returns null for a component without a grade", () => {
    const cursados = [componente({ codigo: "MATA55", nota: null, situacao: "MATR" })];
    expect(impactoNoCr(cursados, "MATA55")).toBeNull();
  });

  it("returns null when removing the component would leave nothing graded", () => {
    const cursados = [componente({ codigo: "MATA37", nota: 8 })];
    expect(impactoNoCr(cursados, "MATA37")).toBeNull();
  });
});

describe("formatarImpacto", () => {
  it("renders a positive impact with an upward arrow", () => {
    expect(formatarImpacto(0.0842)).toBe("↑ 0,08");
  });

  it("renders a negative impact with a downward arrow, without a minus sign", () => {
    expect(formatarImpacto(-0.031)).toBe("↓ 0,03");
  });

  it("renders no change as an em dash", () => {
    expect(formatarImpacto(0)).toBe("—");
  });

  it("renders an absent impact as an em dash", () => {
    expect(formatarImpacto(null)).toBe("—");
  });
});
