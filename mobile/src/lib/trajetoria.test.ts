import {
  agruparPorAno,
  agruparPorSemestre,
  calcularCrAcumulado,
  componentesComCargaHorariaContada,
  contarFaltantes,
  densidadeCarga,
  formatarCoeficiente,
  formatarImpacto,
  formatarNota,
  formatarSemestre,
  historicoDesatualizado,
  impactoNoCr,
  percentualConcluido,
  direcaoDoSwipe,
  poolPlanejavel,
  proximoInsight,
  posicaoSemestral,
  rotuloRitmo,
  rotuloSituacao,
  rotulosPorAno,
  segmentosSemestralizacao,
  somarCargaHoraria,
  statusComponente,
  variacaoUltimoPeriodo,
  zonasDePlanejamento,
} from "./trajetoria";
import type { ComponenteCursado, ComponentePendente, MarcoSemestre } from "./types";

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

describe("contarFaltantes", () => {
  const pendentes: ComponentePendente[] = [
    { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 60, matriculado: false },
    { codigo: "MATA59", nome: "REDES", cargaHoraria: 60, matriculado: true },
    { codigo: "ENADE", nome: "ENADE", cargaHoraria: 0, matriculado: false },
  ];

  it("counts a component the student is already taking as still missing", () => {
    // Unlike poolPlanejavel — the planner shouldn't offer to move something
    // already placed — this is "how many left", and enrolled-but-ungraded
    // is still not done.
    expect(contarFaltantes(pendentes)).toBe(2);
  });

  it("excludes ENADE, which isn't a curricular component", () => {
    expect(contarFaltantes([pendentes[2]])).toBe(0);
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

describe("componentesComCargaHorariaContada", () => {
  it("keeps a component that was approved, failed, dispensed, transferred or is still enrolled", () => {
    const componentes = [
      componente({ codigo: "A", situacao: "APR" }),
      componente({ codigo: "B", situacao: "REP" }),
      componente({ codigo: "C", situacao: "REPF" }),
      componente({ codigo: "D", situacao: "REPMF" }),
      componente({ codigo: "E", situacao: "DISP" }),
      componente({ codigo: "F", situacao: "CUMP" }),
      componente({ codigo: "G", situacao: "INCORP" }),
      componente({ codigo: "H", situacao: "TRANS" }),
      componente({ codigo: "I", situacao: "MATR", nota: null }),
    ];

    expect(componentesComCargaHorariaContada(componentes).map((c) => c.codigo)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
    ]);
  });

  it("drops a locked or cancelled component", () => {
    const componentes = [
      componente({ codigo: "A", situacao: "TRANC" }),
      componente({ codigo: "B", situacao: "CANC" }),
    ];

    expect(componentesComCargaHorariaContada(componentes)).toEqual([]);
  });
});

describe("direcaoDoSwipe", () => {
  it("reads a leftward drag past the threshold", () => {
    expect(direcaoDoSwipe(-60, 0)).toBe("esquerda");
  });

  it("reads a rightward drag past the threshold", () => {
    expect(direcaoDoSwipe(60, 0)).toBe("direita");
  });

  it("returns null below the swipe threshold", () => {
    expect(direcaoDoSwipe(-20, 0)).toBeNull();
  });

  it("returns null for a drag leaning more vertical than horizontal", () => {
    expect(direcaoDoSwipe(-60, 80)).toBeNull();
  });
});

describe("proximoInsight", () => {
  it("steps to cargaHoraria on a clear leftward swipe from cr", () => {
    expect(proximoInsight("cr", -60, 0)).toBe("cargaHoraria");
  });

  it("steps back to cr on a clear rightward swipe from cargaHoraria", () => {
    expect(proximoInsight("cargaHoraria", 60, 0)).toBe("cr");
  });

  it("clamps rather than wrapping past the first or last tab", () => {
    expect(proximoInsight("cr", 60, 0)).toBe("cr");
    expect(proximoInsight("cargaHoraria", -60, 0)).toBe("cargaHoraria");
  });

  it("ignores a drag that hasn't cleared the swipe threshold", () => {
    expect(proximoInsight("cr", -20, 0)).toBe("cr");
  });

  it("ignores a drag that leans more vertical than horizontal — a scroll, not a swipe", () => {
    expect(proximoInsight("cr", -60, 80)).toBe("cr");
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

describe("rotulosPorAno", () => {
  it("labels only the first term of each year, blanking the rest", () => {
    expect(rotulosPorAno(["2024.1", "2024.2", "2025.1"])).toEqual(["2024", "", "2025"]);
  });

  it("labels the sole term of a lone year", () => {
    expect(rotulosPorAno(["2026.1"])).toEqual(["2026"]);
  });

  it("returns nothing for an empty series", () => {
    expect(rotulosPorAno([])).toEqual([]);
  });
});

describe("variacaoUltimoPeriodo", () => {
  it("is positive when the CR rose from the term before the latest one", () => {
    const serie = [
      { semestre: "2025.1", cr: 8 },
      { semestre: "2025.2", cr: 8.5 },
    ];
    expect(variacaoUltimoPeriodo(serie)).toBeCloseTo(0.5);
  });

  it("is negative when the CR fell from the term before the latest one", () => {
    const serie = [
      { semestre: "2025.1", cr: 8.5 },
      { semestre: "2025.2", cr: 8 },
    ];
    expect(variacaoUltimoPeriodo(serie)).toBeCloseTo(-0.5);
  });

  it("is zero when the CR held steady", () => {
    const serie = [
      { semestre: "2025.1", cr: 8 },
      { semestre: "2025.2", cr: 8 },
    ];
    expect(variacaoUltimoPeriodo(serie)).toBe(0);
  });

  it("returns null with less than two terms — nothing to compare against", () => {
    expect(variacaoUltimoPeriodo([{ semestre: "2025.1", cr: 8 }])).toBeNull();
    expect(variacaoUltimoPeriodo([])).toBeNull();
  });

  it("returns null when either term has nothing graded yet", () => {
    const serie = [
      { semestre: "2025.1", cr: null },
      { semestre: "2025.2", cr: 8 },
    ];
    expect(variacaoUltimoPeriodo(serie)).toBeNull();
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

describe("rotuloRitmo", () => {
  it("labels adiantado", () => {
    expect(rotuloRitmo("adiantado")).toBe("Adiantado(a)");
  });

  it("labels atrasado", () => {
    expect(rotuloRitmo("atrasado")).toBe("Atrasado(a)");
  });

  it("labels no_ritmo", () => {
    expect(rotuloRitmo("no_ritmo")).toBe("No ritmo");
  });

  it("renders no label when ritmo could not be resolved", () => {
    expect(rotuloRitmo(null)).toBeNull();
  });
});

describe("statusComponente", () => {
  const marcos = {
    marcos: [],
    ritmo: null,
    obsoletas: ["VELHA1"],
    equivalencias: [{ codigo: "VELHA2", equivalenteDe: "NOVA2" }],
  };

  it("flags a componente listed among the obsoletas", () => {
    expect(statusComponente("VELHA1", marcos)).toEqual({ tipo: "obsoleta" });
  });

  it("flags a componente listed among the equivalências, naming its replacement", () => {
    expect(statusComponente("VELHA2", marcos)).toEqual({
      tipo: "equivalente",
      equivalenteDe: "NOVA2",
    });
  });

  it("returns null for a componente still on the active grade", () => {
    expect(statusComponente("QUALQUERUM", marcos)).toBeNull();
  });

  it("returns null when marcos never resolved", () => {
    expect(statusComponente("VELHA1", null)).toBeNull();
  });
});

describe("segmentosSemestralizacao", () => {
  const marcos: MarcoSemestre[] = [
    { periodo: 1, cargaHorariaAcumulada: 100, percentual: 10 },
    { periodo: 2, cargaHorariaAcumulada: 250, percentual: 25 },
    { periodo: 3, cargaHorariaAcumulada: 400, percentual: 40 },
  ];

  it("sizes each segmento by its own share of the total, not the running total", () => {
    const segmentos = segmentosSemestralizacao(marcos, 0);

    expect(segmentos.map((s) => s.larguraPercentual)).toEqual([10, 15, 15]);
  });

  it("fills a segmento completely once integralizada reaches its marco", () => {
    const segmentos = segmentosSemestralizacao(marcos, 250);

    expect(segmentos.map((s) => s.preenchimento)).toEqual([1, 1, 0]);
  });

  it("fills the in-progress segmento proportionally to how far into it integralizada sits", () => {
    const segmentos = segmentosSemestralizacao(marcos, 175);

    // 175 is halfway between o marco do período 1 (100) e o do período 2 (250).
    expect(segmentos[1].preenchimento).toBeCloseTo(0.5);
  });

  it("leaves every segmento empty when nothing has been integralizado yet", () => {
    const segmentos = segmentosSemestralizacao(marcos, 0);

    expect(segmentos.map((s) => s.preenchimento)).toEqual([0, 0, 0]);
  });

  it("returns an empty list when there are no marcos", () => {
    expect(segmentosSemestralizacao([], 100)).toEqual([]);
  });
});

describe("posicaoSemestral", () => {
  it("counts every fully preenchido segmento toward concluidos, and sums every fraction into posicaoFracionaria", () => {
    const segmentos = segmentosSemestralizacao(
      [
        { periodo: 1, cargaHorariaAcumulada: 100, percentual: 10 },
        { periodo: 2, cargaHorariaAcumulada: 250, percentual: 25 },
        { periodo: 3, cargaHorariaAcumulada: 400, percentual: 40 },
      ],
      175, // completo o período 1 (100) e estou na metade do 2 (100→250)
    );

    expect(posicaoSemestral(segmentos)).toEqual({
      concluidos: 1,
      total: 3,
      posicaoFracionaria: 1.5,
    });
  });

  it("reports zero concluidos and a zero posição when nothing has been integralizado", () => {
    const segmentos = segmentosSemestralizacao(
      [{ periodo: 1, cargaHorariaAcumulada: 100, percentual: 100 }],
      0,
    );

    expect(posicaoSemestral(segmentos)).toEqual({
      concluidos: 0,
      total: 1,
      posicaoFracionaria: 0,
    });
  });

  it("reports every segmento concluído and a posição equal to the total when the course is done", () => {
    const segmentos = segmentosSemestralizacao(
      [
        { periodo: 1, cargaHorariaAcumulada: 100, percentual: 50 },
        { periodo: 2, cargaHorariaAcumulada: 200, percentual: 100 },
      ],
      200,
    );

    expect(posicaoSemestral(segmentos)).toEqual({
      concluidos: 2,
      total: 2,
      posicaoFracionaria: 2,
    });
  });

  it("reports zero total when there are no segmentos at all", () => {
    expect(posicaoSemestral([])).toEqual({ concluidos: 0, total: 0, posicaoFracionaria: 0 });
  });
});

describe("formatarSemestre", () => {
  it("renders one decimal place with a comma", () => {
    expect(formatarSemestre(5.3)).toBe("5,3");
  });

  it("renders a whole number with a trailing ,0", () => {
    expect(formatarSemestre(5)).toBe("5,0");
  });
});

describe("densidadeCarga", () => {
  it("classifies up to 50h as nível 1 (leve)", () => {
    expect(densidadeCarga(34)).toEqual({ nivel: 1, cor: expect.any(String) });
    expect(densidadeCarga(50)).toMatchObject({ nivel: 1 });
  });

  it("classifies 51h–75h as nível 2 (média)", () => {
    expect(densidadeCarga(51)).toMatchObject({ nivel: 2 });
    expect(densidadeCarga(68)).toMatchObject({ nivel: 2 });
    expect(densidadeCarga(75)).toMatchObject({ nivel: 2 });
  });

  it("classifies 76h–100h as nível 3 (pesada)", () => {
    expect(densidadeCarga(76)).toMatchObject({ nivel: 3 });
    expect(densidadeCarga(90)).toMatchObject({ nivel: 3 });
    expect(densidadeCarga(100)).toMatchObject({ nivel: 3 });
  });

  it("classifies above 100h as nível 4 (muito densa)", () => {
    expect(densidadeCarga(101)).toMatchObject({ nivel: 4 });
    expect(densidadeCarga(120)).toMatchObject({ nivel: 4 });
  });

  it("gives each nível a distinct color", () => {
    const cores = new Set(
      [34, 68, 90, 120].map((horas) => densidadeCarga(horas).cor),
    );
    expect(cores.size).toBe(4);
  });
});
