import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursoLista } from './curso-lista';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseCursoLista', () => {
  const cursos = parseCursoLista(fixture('curso-lista.html'));

  it('extracts idSigaa, nome, sede and nivel from each course row', () => {
    const engComp = cursos.find(
      (c) => c.nome === 'ENGENHARIA DA COMPUTAÇÃO' && c.nivel === 'G',
    );
    expect(engComp).toEqual({
      idSigaa: '1876880',
      nome: 'ENGENHARIA DA COMPUTAÇÃO',
      sede: 'SALVADOR',
      nivel: 'G',
    });
  });

  it('skips the unidade header rows, which have no course link of their own', () => {
    expect(cursos.some((c) => c.nome.includes('ESCOLA POLITÉCNICA'))).toBe(
      false,
    );
  });

  it('parses more than one course', () => {
    expect(cursos.length).toBeGreaterThan(50);
  });
});
