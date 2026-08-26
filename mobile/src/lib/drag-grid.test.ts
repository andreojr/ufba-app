import {
  COLUNAS_GRID,
  ESPACO_QUADRADINHO,
  REMOVER_DO_PLANO,
  TAMANHO_QUADRADINHO,
  posicionarQuadradinhos,
  quadradinhoNoPonto,
  quadradinhosDoGrid,
  type Retangulo,
} from "./drag-grid";

describe("quadradinhoNoPonto", () => {
  const retangulos: Retangulo[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 100, y: 0, width: 100, height: 100 },
  ];

  it("acerta o retângulo que contém o ponto", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 50, y: 50 })).toBe("a");
    expect(quadradinhoNoPonto(retangulos, { x: 150, y: 50 })).toBe("b");
  });

  it("retorna null quando o ponto está fora de tudo", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 500, y: 500 })).toBeNull();
  });

  it("na sobreposição, o último da lista ganha", () => {
    const sobrepostos: Retangulo[] = [
      { id: "baixo", x: 0, y: 0, width: 100, height: 100 },
      { id: "cima", x: 0, y: 0, width: 100, height: 100 },
    ];
    expect(quadradinhoNoPonto(sobrepostos, { x: 10, y: 10 })).toBe("cima");
  });

  it("borda inclusiva", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 100, y: 0 })).toBe("b");
  });
});

describe("quadradinhosDoGrid", () => {
  it("um quadradinho por semestre projetado, mais um pontilhado no fim", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2", "2027.1"], "2026.2", false);

    expect(quadradinhos.map((q) => q.id)).toEqual(["2026.2", "2027.1", "2027.2"]);
    expect(quadradinhos[2].pontilhado).toBe(true);
    expect(quadradinhos[0].pontilhado).toBe(false);
  });

  it("desabilita o quadradinho do semestre atual do card", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2", "2027.1"], "2027.1", false);

    expect(quadradinhos.find((q) => q.id === "2027.1")?.desabilitado).toBe(true);
    expect(quadradinhos.find((q) => q.id === "2026.2")?.desabilitado).toBe(false);
  });

  it("inclui 'tirar do plano' só quando manual", () => {
    const semManual = quadradinhosDoGrid(["2026.2"], "2026.2", false);
    const comManual = quadradinhosDoGrid(["2026.2"], "2026.2", true);

    expect(semManual.some((q) => q.id === REMOVER_DO_PLANO)).toBe(false);
    expect(comManual.some((q) => q.id === REMOVER_DO_PLANO)).toBe(true);
  });
});

describe("posicionarQuadradinhos", () => {
  it("preenche em COLUNAS_GRID colunas, esquerda pra direita, cima pra baixo", () => {
    const quadradinhos = quadradinhosDoGrid(
      Array.from({ length: COLUNAS_GRID + 1 }, (_, i) => `202${i}.1`),
      "2020.1",
      false,
    );
    const posicionados = posicionarQuadradinhos(quadradinhos, 0, 0);

    expect(posicionados[0]).toMatchObject({ x: 0, y: 0 });
    expect(posicionados[1]).toMatchObject({ x: TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO, y: 0 });
    // O (COLUNAS_GRID)-ésimo item (índice COLUNAS_GRID) começa a segunda linha.
    expect(posicionados[COLUNAS_GRID]).toMatchObject({ x: 0, y: TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO });
  });

  it("respeita a origem informada", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2"], "2026.2", false);
    const [primeiro] = posicionarQuadradinhos(quadradinhos, 20, 30);

    expect(primeiro.x).toBe(20);
    expect(primeiro.y).toBe(30);
    expect(primeiro.width).toBe(TAMANHO_QUADRADINHO);
    expect(primeiro.height).toBe(TAMANHO_QUADRADINHO);
  });
});
