import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocentePortal } from './docente-portal';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseDocentePortal', () => {
  it('reads the contact block, which is the part that is almost always filled', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-rico.html'));
    expect(perfil.sala).toBe('IC- 2012');
    expect(perfil.telefone).toBe('6299');
    expect(perfil.email).toBe('antonio.apolinario@ufba.br');
  });

  it('reads nome and unidade from the #left sidebar', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-rico.html'));
    expect(perfil.nome).toBe('ANTONIO LOPES APOLINARIO JUNIOR');
    expect(perfil.unidade).toBe('INSTITUTO DE COMPUTAÇÃO');
  });

  it('splits multi-line dd values on <br /> instead of gluing them together', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-rico.html'));
    expect(perfil.areasInteresse.length).toBeGreaterThan(1);
    expect(perfil.areasInteresse.every((a) => a.length > 0)).toBe(true);
    expect(perfil.areasInteresse.join('')).not.toContain('\n');
  });

  it('picks up the Lattes URL', () => {
    expect(
      parseDocentePortal(fixture('docente-portal-rico.html')).lattesUrl,
    ).toMatch(/^https?:\/\/lattes\.cnpq\.br\//);
  });

  // The empty profile is the common case — 3 of 4 on a real atestado — so it is
  // the one that must not throw and must not fake data.
  it('returns nulls and empty arrays for a "Perfil pessoal não cadastrado" page', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-vazio.html'));
    expect(perfil.descricaoPessoal).toBeNull();
    expect(perfil.formacao).toEqual([]);
    expect(perfil.areasInteresse).toEqual([]);
    expect(perfil.lattesUrl).toBeNull();
  });

  it('still finds the contact block on an otherwise empty profile', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-vazio.html'));
    expect(perfil.email).not.toBeNull();
  });

  it('nulls contact fields marked "não informado(a)" instead of returning the literal placeholder', () => {
    const perfil = parseDocentePortal(fixture('docente-portal-vazio.html'));
    expect(perfil.sala).toBeNull();
    expect(perfil.enderecoProfissional).toBeNull();
  });

  it('degrades to all-null rather than throwing on unrecognised markup', () => {
    expect(() =>
      parseDocentePortal('<html><body>nope</body></html>'),
    ).not.toThrow();
    expect(
      parseDocentePortal('<html><body>nope</body></html>').nome,
    ).toBeNull();
  });
});
