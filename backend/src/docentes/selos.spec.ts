import { calcularSelos } from './selos';
import type { DocenteSalvo } from './docente.repository';

function docente(overrides: Partial<DocenteSalvo> = {}): DocenteSalvo {
  return {
    siape: '1815041',
    nome: 'FULANO',
    departamento: null,
    unidade: null,
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: null,
    telefone: null,
    email: null,
    disciplinas: [],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0,
      mestradoConcluidas: 0,
      doutoradoAndamento: 0,
      doutoradoConcluidas: 0,
    },
    fetchedAt: new Date(),
    staleAfter: new Date(),
    ...overrides,
  };
}

describe('calcularSelos', () => {
  it('is all-false for the empty profile that is the common case', () => {
    expect(calcularSelos(docente())).toEqual({
      contato: false,
      formacao: false,
      areasInteresse: false,
      lattes: false,
      orientacoes: false,
      semestresLecionando: 0,
    });
  });

  it('lights contato when any one contact field is present', () => {
    expect(calcularSelos(docente({ sala: 'IC-2012' })).contato).toBe(true);
    expect(calcularSelos(docente({ email: 'x@ufba.br' })).contato).toBe(true);
  });

  it('lights orientacoes for a supervised TCC alone, with all counts at zero', () => {
    expect(
      calcularSelos(docente({ tccsOrientados: [{ titulo: 'X', ano: 2024 }] }))
        .orientacoes,
    ).toBe(true);
  });

  it('counts distinct terms, not course rows', () => {
    const disciplinas = [
      {
        semestre: '2026.2',
        codigo: 'MATA65',
        nome: 'CG',
        cargaHoraria: 60,
        horario: '',
      },
      {
        semestre: '2026.2',
        codigo: 'MATA62',
        nome: 'IA',
        cargaHoraria: 60,
        horario: '',
      },
      {
        semestre: '2026.1',
        codigo: 'MATA65',
        nome: 'CG',
        cargaHoraria: 60,
        horario: '',
      },
    ];
    expect(calcularSelos(docente({ disciplinas })).semestresLecionando).toBe(2);
  });
});
