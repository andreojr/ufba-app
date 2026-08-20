import { construirLayout } from './arvore-dependencias-layout';

describe('construirLayout', () => {
  it('calcula posições numéricas para cada nó e pontos para cada aresta', () => {
    const layout = construirLayout({
      nos: [
        { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 },
        { codigo: 'MATA03', nome: 'Cálculo B', periodo: 2 },
        { codigo: 'ENGB01', nome: 'Mecânica dos Sólidos', periodo: 3 },
      ],
      arestas: [
        { de: 'MATA02', para: 'MATA03' },
        { de: 'MATA03', para: 'ENGB01' },
      ],
    });

    expect(layout.nos).toHaveLength(3);
    for (const no of layout.nos) {
      expect(typeof no.x).toBe('number');
      expect(typeof no.y).toBe('number');
      expect(Number.isNaN(no.x)).toBe(false);
      expect(Number.isNaN(no.y)).toBe(false);
    }
    // MATA02 é raiz (rank mais alto na hierarquia) — deve vir "antes" (y menor)
    // que seus descendentes num layout top-to-bottom.
    const porCodigo = Object.fromEntries(layout.nos.map((n) => [n.codigo, n]));
    expect(porCodigo.MATA02.y).toBeLessThan(porCodigo.MATA03.y);
    expect(porCodigo.MATA03.y).toBeLessThan(porCodigo.ENGB01.y);

    expect(layout.arestas).toHaveLength(2);
    for (const aresta of layout.arestas) {
      expect(aresta.pontos.length).toBeGreaterThan(0);
    }
    expect(layout.largura).toBeGreaterThan(0);
    expect(layout.altura).toBeGreaterThan(0);
  });

  it('nó com múltiplos pais aparece uma única vez no layout', () => {
    const layout = construirLayout({
      nos: [
        { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 },
        { codigo: 'FISB08', nome: 'Física B', periodo: 1 },
        { codigo: 'ENGB01', nome: 'Mecânica dos Sólidos', periodo: 2 },
      ],
      arestas: [
        { de: 'MATA02', para: 'ENGB01' },
        { de: 'FISB08', para: 'ENGB01' },
      ],
    });
    expect(layout.nos.filter((n) => n.codigo === 'ENGB01')).toHaveLength(1);
    expect(layout.arestas).toHaveLength(2);
  });

  it('grafo com só o nó raiz (sem descendentes) não quebra', () => {
    const layout = construirLayout({
      nos: [{ codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4 }],
      arestas: [],
    });
    expect(layout.nos).toHaveLength(1);
    expect(layout.arestas).toHaveLength(0);
  });
});
