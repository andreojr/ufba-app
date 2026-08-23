import type { ComponentePendente } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';
import { montarFila } from './fila-de-pendentes';

function componente(
  codigo: string,
  periodo: number | null,
  extras: Partial<ComponenteCurricularSalvo> = {},
): ComponenteCurricularSalvo {
  return {
    idSigaa: codigo,
    codigo,
    nome: codigo,
    cargaHoraria: 60,
    natureza: 'OBRIGATORIA',
    periodo,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
    ...extras,
  };
}

function pendente(
  codigo: string,
  extras: Partial<ComponentePendente> = {},
): ComponentePendente {
  return { codigo, nome: codigo, cargaHoraria: 60, matriculado: false, ...extras };
}

describe('montarFila', () => {
  it('ordena por período da grade', () => {
    const fila = montarFila(
      [pendente('C'), pendente('A'), pendente('B')],
      [componente('A', 1), componente('B', 2), componente('C', 3)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'B', 'C']);
  });

  it('marca como atrasada a pendente de período já vencido', () => {
    const fila = montarFila(
      [pendente('A'), pendente('B')],
      [componente('A', 3), componente('B', 6)],
      [],
      6,
    );
    expect(fila.find((i) => i.codigo === 'A')?.atrasada).toBe(true);
    // Período 6 com o aluno no 6º não está atrasada: é a do semestre corrente.
    expect(fila.find((i) => i.codigo === 'B')?.atrasada).toBe(false);
  });

  it('herda o período do substituto quando a pendente é equivalente', () => {
    const fila = montarFila(
      [pendente('VELHA2')],
      [componente('NOVA2', 4, { preRequisito: '(MATA01)' })],
      [{ codigo: 'VELHA2', equivalenteDe: 'NOVA2' }],
      6,
    );
    expect(fila[0]).toMatchObject({
      codigo: 'VELHA2',
      periodo: 4,
      atrasada: true,
      preRequisito: '(MATA01)',
    });
  });

  it('joga a obsoleta pura para o fim, sem período e sem atraso', () => {
    const fila = montarFila(
      [pendente('SUMIU'), pendente('A')],
      [componente('A', 5)],
      [],
      6,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'SUMIU']);
    expect(fila[1]).toMatchObject({
      periodo: null,
      atrasada: false,
      preRequisito: null,
    });
  });

  it('exclui quem já está matriculado — a matéria está sendo cursada agora', () => {
    const fila = montarFila(
      [pendente('A', { matriculado: true }), pendente('B')],
      [componente('A', 1), componente('B', 2)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['B']);
  });

  it('exclui as linhas de ENADE, que não são componente curricular', () => {
    const fila = montarFila([pendente('ENADE'), pendente('A')], [componente('A', 1)], [], 1);
    expect(fila.map((i) => i.codigo)).toEqual(['A']);
  });

  it('desempata por código, para a projeção não mudar entre duas leituras', () => {
    const fila = montarFila(
      [pendente('Z'), pendente('A')],
      [componente('A', 2), componente('Z', 2)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'Z']);
  });
});
