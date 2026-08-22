import { montarVizinhos, type ComponenteParaVizinhos, type HistoricoParaVizinhos } from './vizinhos-curriculares';

describe('montarVizinhos', () => {
  const componentes: ComponenteParaVizinhos[] = [
    { codigo: 'MATA02', nome: 'Cálculo A', preRequisito: null },
    { codigo: 'FISB08', nome: 'Física B', preRequisito: null },
    { codigo: 'MATA03', nome: 'Cálculo B', preRequisito: 'MATA02' },
    { codigo: 'MATA04', nome: 'Cálculo C', preRequisito: 'MATA03' },
    // Cita um código (ENGJ18) que não existe na grade — deve ser ignorado
    // ao montar o bloco de pré-requisitos exibidos (mas ainda conta como
    // não-satisfeito na avaliação de situação, já coberto pelos testes do
    // avaliador em avaliador-prerequisito.spec.ts).
    { codigo: 'ENGC30', nome: 'Mecânica dos Sólidos', preRequisito: '(MATA03 E FISB08) OU (ENGJ18)' },
  ];

  function historico(aprovados: string[] = [], matriculados: string[] = []): HistoricoParaVizinhos {
    return { aprovados: new Set(aprovados), matriculados: new Set(matriculados) };
  }

  it('monta pré-requisitos diretos e quem desbloqueia diretamente, com situação de cada um', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA03', historico(['MATA02']));
    expect(vizinhos).toEqual({
      atual: { codigo: 'MATA03', nome: 'Cálculo B', situacao: 'liberada' },
      preRequisitos: [{ codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' }],
      desbloqueia: [{ codigo: 'MATA04', nome: 'Cálculo C', situacao: 'bloqueada' }],
    });
  });

  it('cursada (APR) tem prioridade sobre o cálculo de liberada/bloqueada', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA02', historico(['MATA02']));
    expect(vizinhos?.atual).toEqual({ codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' });
  });

  it('emCurso (MATR) tem prioridade sobre liberada/bloqueada, mas não sobre cursada', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA03', historico(['MATA02'], ['MATA03']));
    expect(vizinhos?.atual).toEqual({ codigo: 'MATA03', nome: 'Cálculo B', situacao: 'emCurso' });
  });

  it('código citado ausente da grade não aparece na lista de pré-requisitos exibidos', () => {
    const vizinhos = montarVizinhos(componentes, 'ENGC30', historico(['MATA02', 'MATA03', 'FISB08']));
    expect(vizinhos?.preRequisitos.map((v) => v.codigo).sort()).toEqual(['FISB08', 'MATA03']);
  });

  it('matéria sem pré-requisito (ex: período 1) devolve preRequisitos vazio', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA02', historico());
    expect(vizinhos?.preRequisitos).toEqual([]);
  });

  it('matéria que nada desbloqueia (ex: última do curso) devolve desbloqueia vazio', () => {
    const vizinhos = montarVizinhos(componentes, 'ENGC30', historico());
    expect(vizinhos?.desbloqueia).toEqual([]);
  });

  it('código raiz que não existe na grade devolve null', () => {
    expect(montarVizinhos(componentes, 'XXXX00', historico())).toBeNull();
  });
});
