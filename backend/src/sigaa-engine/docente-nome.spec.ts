import { normalizarNomeDocente } from './docente-nome';

describe('normalizarNomeDocente', () => {
  it('uppercases, strips diacritics and collapses whitespace', () => {
    expect(normalizarNomeDocente('  Luís   da Paixão  ')).toBe('LUIS DA PAIXAO');
  });

  it('makes the atestado spelling and the registry spelling agree', () => {
    // The registry is not uniform: mixed case and accents both occur.
    expect(normalizarNomeDocente('Clayton Silva de Almeida')).toBe(
      normalizarNomeDocente('CLAYTON SILVA DE ALMEIDA'),
    );
  });

  it('leaves distinct names distinct so a prefix cannot swallow a longer name', () => {
    // Measured: ALINE SILVA ⊂ ALINE SILVA DE MOURA is the one collision in 339.
    expect(normalizarNomeDocente('ALINE SILVA')).not.toBe(
      normalizarNomeDocente('ALINE SILVA DE MOURA'),
    );
  });

  it('produces pure ASCII, which is what makes the ISO-8859-1 POST body safe', () => {
    expect(normalizarNomeDocente('ANDRÉ GUSTAVO SCOLARI CONCEIÇÃO')).toMatch(/^[A-Z ]+$/);
  });
});
