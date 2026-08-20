import { construirArvoreDependencias, extrairCodigosCitados, type ComponenteParaArvore } from './arvore-dependencias';

describe('extrairCodigosCitados', () => {
  it('extrai códigos de uma expressão com E', () => {
    expect(extrairCodigosCitados('FISD36 E FISD42')).toEqual(['FISD36', 'FISD42']);
  });

  it('extrai códigos de uma expressão com E e OU e parênteses', () => {
    expect(extrairCodigosCitados('(FISD36 E FISD42) OU (ENGJ18)')).toEqual([
      'FISD36',
      'FISD42',
      'ENGJ18',
    ]);
  });

  it('não duplica um código citado mais de uma vez', () => {
    expect(extrairCodigosCitados('(MATA02) OU (MATA02 E FISD36)')).toEqual([
      'MATA02',
      'FISD36',
    ]);
  });

  it('devolve lista vazia para texto nulo ou sem pré-requisito', () => {
    expect(extrairCodigosCitados(null)).toEqual([]);
    expect(extrairCodigosCitados('')).toEqual([]);
  });

  it('reconhece código com letra final (ex: equivalência ENG295A)', () => {
    expect(extrairCodigosCitados('ENG295A')).toEqual(['ENG295A']);
  });
});

describe('construirArvoreDependencias', () => {
  const componentes: ComponenteParaArvore[] = [
    { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1, preRequisito: null },
    { codigo: 'FISB08', nome: 'Física B', periodo: 2, preRequisito: null },
    {
      codigo: 'MATA03',
      nome: 'Cálculo B',
      periodo: 2,
      preRequisito: '(MATA02)',
    },
    {
      codigo: 'ENGB01',
      nome: 'Mecânica dos Sólidos',
      periodo: 3,
      // Cita um código (ENGJ18) que não existe nesta grade — deve ser
      // ignorado, não vira nó nem aresta.
      preRequisito: '(MATA03 E FISB08) OU (ENGJ18)',
    },
    { codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4, preRequisito: 'ENGB01' },
    { codigo: 'HISA01', nome: 'História Geral', periodo: 1, preRequisito: null },
  ];

  it('monta o DAG completo de descendentes a partir da raiz', () => {
    const arvore = construirArvoreDependencias(componentes, 'MATA02');
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(
      ['MATA02', 'MATA03', 'ENGB01', 'ENGC02'].sort(),
    );
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'MATA02', para: 'MATA03' },
        { de: 'MATA03', para: 'ENGB01' },
        { de: 'ENGB01', para: 'ENGC02' },
      ]),
    );
    // FISB08 e HISA01 não são descendentes de MATA02 e não devem aparecer.
    expect(arvore.nos.map((n) => n.codigo)).not.toContain('FISB08');
    expect(arvore.nos.map((n) => n.codigo)).not.toContain('HISA01');
  });

  it('nó com múltiplos pais aparece uma única vez, com uma aresta por pai', () => {
    const arvore = construirArvoreDependencias(componentes, 'FISB08');
    // FISB08 é citado por ENGB01, que também depende de MATA03 → MATA02.
    // A partir de FISB08 só o ramo ENGB01→ENGC02 é alcançável.
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['FISB08', 'ENGB01', 'ENGC02'].sort());
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'FISB08', para: 'ENGB01' },
        { de: 'ENGB01', para: 'ENGC02' },
      ]),
    );
  });

  it('matéria sem nenhum descendente devolve grafo com só o nó raiz e nenhuma aresta', () => {
    const arvore = construirArvoreDependencias(componentes, 'ENGC02');
    expect(arvore.nos).toEqual([{ codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4 }]);
    expect(arvore.arestas).toEqual([]);
  });

  it('código raiz que não existe na grade devolve grafo vazio', () => {
    expect(construirArvoreDependencias(componentes, 'XXXX00')).toEqual({ nos: [], arestas: [] });
  });

  it('não entra em loop infinito com um ciclo (defensivo — não esperado num currículo real)', () => {
    const comCiclo: ComponenteParaArvore[] = [
      { codigo: 'A1', nome: 'A', periodo: 1, preRequisito: 'B1' },
      { codigo: 'B1', nome: 'B', periodo: 1, preRequisito: 'A1' },
    ];
    const arvore = construirArvoreDependencias(comCiclo, 'A1');
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['A1', 'B1']);
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'A1', para: 'B1' },
        { de: 'B1', para: 'A1' },
      ]),
    );
  });
});
