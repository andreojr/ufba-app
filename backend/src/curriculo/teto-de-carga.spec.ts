import type { ComponenteCursado } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';
import { tetoDeCarga } from './teto-de-carga';

function componente(
  periodo: number | null,
  cargaHoraria: number,
  codigo = `C${periodo}-${cargaHoraria}`,
): ComponenteCurricularSalvo {
  return {
    idSigaa: codigo,
    codigo,
    nome: codigo,
    cargaHoraria,
    natureza: periodo === null ? 'OPTATIVA' : 'OBRIGATORIA',
    periodo,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };
}

function cursado(
  semestre: string,
  cargaHoraria: number,
  situacao: ComponenteCursado['situacao'] = 'APR',
): ComponenteCursado {
  return {
    semestre,
    natureza: 'OB',
    codigo: `${semestre}-${cargaHoraria}-${situacao}`,
    nome: 'MATÉRIA',
    cargaHoraria,
    nota: 8,
    situacao,
    docente: null,
  };
}

// Grade: período 1 com 300h (o mais leve), período 2 com 400h (o mais pesado).
const GRADE = [
  componente(1, 150, 'A1'),
  componente(1, 150, 'A2'),
  componente(2, 200, 'B1'),
  componente(2, 200, 'B2'),
];

describe('tetoDeCarga', () => {
  it('usa o recorde do aluno quando ele fica abaixo do período mais pesado', () => {
    const cursados = [cursado('2025.1', 340)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(340);
  });

  it('não passa do período mais pesado da grade, mesmo com recorde maior', () => {
    const cursados = [cursado('2025.1', 500)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(400);
  });

  it('não desce abaixo do período mais leve, mesmo com um semestre atípico', () => {
    // Um semestre em que ele fechou só 30h travaria a projeção em 2035.
    const cursados = [cursado('2025.1', 30)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(300);
  });

  it('cai no período mais pesado quando o aluno não tem semestre fechado', () => {
    expect(tetoDeCarga(GRADE, [])).toBe(400);
  });

  it('ignora trancadas e canceladas ao medir o recorde', () => {
    // 340h cursadas de verdade + 200h abandonadas não fazem um recorde de 540h.
    const cursados = [
      cursado('2025.1', 340),
      cursado('2025.1', 200, 'TRANC'),
    ];
    expect(tetoDeCarga(GRADE, cursados)).toBe(340);
  });

  it('soma o semestre inteiro, não a maior matéria', () => {
    const cursados = [cursado('2025.1', 100), cursado('2025.1', 220)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(320);
  });
});
