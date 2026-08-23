import {
  compararSemestres,
  distanciaEmSemestres,
  proximoSemestre,
} from './semestre';

describe('proximoSemestre', () => {
  it('avança do primeiro para o segundo período do mesmo ano', () => {
    expect(proximoSemestre('2026.1')).toBe('2026.2');
  });

  it('vira o ano ao passar do segundo período', () => {
    expect(proximoSemestre('2026.2')).toBe('2027.1');
  });
});

describe('compararSemestres', () => {
  it('ordena cronologicamente', () => {
    expect(compararSemestres('2025.2', '2026.1')).toBeLessThan(0);
    expect(compararSemestres('2026.1', '2025.2')).toBeGreaterThan(0);
    expect(compararSemestres('2026.1', '2026.1')).toBe(0);
  });
});

describe('distanciaEmSemestres', () => {
  it('conta os semestres entre dois pontos', () => {
    expect(distanciaEmSemestres('2026.1', '2027.2')).toBe(3);
  });

  it('é zero para o mesmo semestre', () => {
    expect(distanciaEmSemestres('2026.1', '2026.1')).toBe(0);
  });

  it('é negativa quando o alvo já passou — quem chama decide se isso importa', () => {
    expect(distanciaEmSemestres('2027.1', '2026.1')).toBe(-2);
  });
});
