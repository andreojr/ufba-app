import {
  classificarUrgencia,
  dataIsoLocal,
  diasAte,
  intercalarDia,
} from "./pontos-atencao";
import type { PontoAtencao } from "./types";
import type { ScheduleBlock } from "./sigaa-schedule";

const AGORA = new Date(2026, 7, 24, 16, 0); // seg 24/08/2026, hora local

function ponto(overrides: Partial<PontoAtencao> = {}): PontoAtencao {
  return {
    id: "p1",
    turmaId: "t1",
    turmaCodigo: "ENGG54",
    turmaNome: "LABORATÓRIO INTEGRADO III-A",
    tipo: "TRABALHO",
    titulo: "Relatório final",
    data: "2026-08-27",
    hora: null,
    observacao: null,
    responsavel: { nome: "Ana" },
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    estado: "NORMAL",
    podeEditar: false,
    podeApagar: false,
    ...overrides,
  };
}

function aula(inicioMin: number): ScheduleBlock {
  return {
    key: `a-${inicioMin}`,
    codigo: "ENGG67",
    nome: "SISTEMAS DIGITAIS",
    inicioMin,
    fimMin: inicioMin + 110,
    predio: "ENG",
    sala: "7.1.4",
    localOriginal: "ENG",
    colorIndex: 3,
  };
}

describe("diasAte", () => {
  it("conta dias de calendário, não janelas de 24h", () => {
    // 16h de segunda até quinta é menos de 72h, mas são 3 dias de calendário.
    expect(diasAte("2026-08-27", AGORA)).toBe(3);
  });

  it("é zero no próprio dia", () => {
    expect(diasAte("2026-08-24", AGORA)).toBe(0);
  });

  it("é negativo depois de vencido", () => {
    expect(diasAte("2026-08-21", AGORA)).toBe(-3);
  });
});

describe("dataIsoLocal", () => {
  it("usa os componentes locais, não UTC", () => {
    // 23h de 24/08 em Salvador é 25/08 02:00 em UTC — toISOString daria o
    // dia errado, e o prazo de hoje não casaria com o bloco de hoje.
    expect(dataIsoLocal(new Date(2026, 7, 24, 23, 0))).toBe("2026-08-24");
  });
});

describe("classificarUrgencia", () => {
  it("é crítico até três dias", () => {
    expect(classificarUrgencia(0)).toBe("critico");
    expect(classificarUrgencia(3)).toBe("critico");
  });

  it("é atenção até dez dias", () => {
    expect(classificarUrgencia(4)).toBe("atencao");
    expect(classificarUrgencia(10)).toBe("atencao");
  });

  it("é distante depois disso", () => {
    expect(classificarUrgencia(11)).toBe("distante");
  });
});

describe("intercalarDia", () => {
  it("põe o prazo sem hora no fim do dia", () => {
    const itens = intercalarDia([aula(1000)], [ponto()]);

    expect(itens.map((i) => i.kind)).toEqual(["aula", "ponto"]);
    expect(itens[1].inicioMin).toBe(23 * 60 + 59);
  });

  it("põe o prazo com hora na posição cronológica certa", () => {
    const itens = intercalarDia([aula(1000), aula(1110)], [ponto({ hora: "17:00" })]);

    expect(itens.map((i) => i.kind)).toEqual(["aula", "ponto", "aula"]);
  });

  it("ignora item contestado", () => {
    const itens = intercalarDia([aula(1000)], [ponto({ estado: "CONTESTADO" })]);

    expect(itens.map((i) => i.kind)).toEqual(["aula"]);
  });
});
