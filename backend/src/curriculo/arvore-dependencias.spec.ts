import { extrairCodigosCitados } from './arvore-dependencias';

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
