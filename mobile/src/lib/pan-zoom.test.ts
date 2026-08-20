import { aplicarPan, aplicarPinch } from "./pan-zoom";

describe("aplicarPinch", () => {
  it("aplica o delta do gesto sobre a escala salva, em vez de substituí-la", () => {
    // Um segundo pinch começando de escala 1.5 e ampliando mais 20%
    // (e.scale === 1.2 no início do novo gesto) deve chegar a 1.8, não travar
    // em 1.2 como aconteceria sem o valor salvo do gesto anterior.
    expect(aplicarPinch(1.5, 1.2, 0.4, 2.5)).toBeCloseTo(1.8);
  });

  it("respeita o clamp mínimo mesmo partindo de uma escala salva alta", () => {
    expect(aplicarPinch(2.0, 0.1, 0.4, 2.5)).toBe(0.4);
  });

  it("respeita o clamp máximo mesmo partindo de uma escala salva baixa", () => {
    expect(aplicarPinch(0.5, 10, 0.4, 2.5)).toBe(2.5);
  });

  it("primeiro gesto (escala salva 1) se comporta como antes", () => {
    expect(aplicarPinch(1, 1.3, 0.4, 2.5)).toBeCloseTo(1.3);
  });
});

describe("aplicarPan", () => {
  it("soma o delta do gesto à translação salva, em vez de substituí-la", () => {
    // Um segundo drag começando de translateX 40 e movendo mais 15px deve
    // chegar a 55, não voltar para 15 como aconteceria sem o valor salvo.
    expect(aplicarPan(40, 15)).toBe(55);
  });

  it("primeiro gesto (translação salva 0) se comporta como antes", () => {
    expect(aplicarPan(0, 25)).toBe(25);
  });

  it("aceita deltas negativos (arrastar na direção oposta)", () => {
    expect(aplicarPan(100, -30)).toBe(70);
  });
});
