import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEstruturaResumo } from './estrutura-resumo';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseEstruturaResumo', () => {
  const resumo = parseEstruturaResumo(fixture('estrutura-resumo.html'));

  it('extracts the ano/período de vigência and the workload totals', () => {
    expect(resumo.anoPeriodoImplementacao).toBe('2025.2');
    expect(resumo.cargaHorariaTotal).toBe(3610);
    expect(resumo.cargaHorariaObrigatoria).toBe(3150);
    expect(resumo.cargaHorariaOptativaMinima).toBe(360);
    expect(resumo.cargaHorariaComplementarMinima).toBe(100);
  });

  it('extracts the prazo de conclusão in semesters', () => {
    expect(resumo.prazoMinimoSemestres).toBe(12);
    expect(resumo.prazoMedioSemestres).toBe(12);
    expect(resumo.prazoMaximoSemestres).toBe(18);
  });

  it('parses an obrigatória component with its período and SIGAA id', () => {
    const fisd36 = resumo.componentes.find((c) => c.codigo === 'FISD36');
    expect(fisd36).toEqual({
      idSigaa: '34997',
      codigo: 'FISD36',
      nome: 'FÍSICA GERAL TEÓRICA I',
      cargaHoraria: 60,
      natureza: 'OBRIGATORIA',
      periodo: 1,
    });
  });

  it('parses an optativa component with a null período', () => {
    const eng295 = resumo.componentes.find((c) => c.codigo === 'ENG295');
    expect(eng295).toEqual({
      idSigaa: '30548',
      codigo: 'ENG295',
      nome: 'HIGIENE E SEGURANÇA NO TRABALHO',
      cargaHoraria: 60,
      natureza: 'OPTATIVA',
      periodo: null,
    });
  });
});
