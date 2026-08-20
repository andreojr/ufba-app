import {
  calcularMarcos,
  classificarComponente,
  compararRitmo,
  montarMarcosResponse,
  type MarcoSemestre,
} from './marcos-semestralizacao';
import type {
  ComponenteCurricularSalvo,
  EstruturaCurricularSalva,
} from './curriculo.repository';
import type { Historico } from '../sigaa-engine/parsers/historico';

function componente(
  overrides: Partial<ComponenteCurricularSalvo> & { codigo: string },
): ComponenteCurricularSalvo {
  return {
    idSigaa: overrides.codigo,
    nome: overrides.codigo,
    cargaHoraria: 60,
    natureza: 'OBRIGATORIA',
    periodo: 1,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
    ...overrides,
  };
}

describe('calcularMarcos', () => {
  it('sums each período’s obrigatória workload into a running total', () => {
    const componentes = [
      componente({ codigo: 'A1', periodo: 1, cargaHoraria: 60 }),
      componente({ codigo: 'A2', periodo: 1, cargaHoraria: 40 }),
      componente({ codigo: 'B1', periodo: 2, cargaHoraria: 80 }),
    ];

    const marcos = calcularMarcos(componentes, 1000);

    const esperado: MarcoSemestre[] = [
      { periodo: 1, cargaHorariaAcumulada: 100, percentual: 10 },
      { periodo: 2, cargaHorariaAcumulada: 180, percentual: 18 },
    ];
    expect(marcos).toEqual(esperado);
  });

  it('ignores optativas and complementares, which carry no período', () => {
    const componentes = [
      componente({ codigo: 'A1', periodo: 1, cargaHoraria: 60 }),
      componente({
        codigo: 'OP1',
        periodo: null,
        natureza: 'OPTATIVA',
        cargaHoraria: 999,
      }),
      componente({
        codigo: 'EC1',
        periodo: null,
        natureza: 'COMPLEMENTAR',
        cargaHoraria: 999,
      }),
    ];

    const marcos = calcularMarcos(componentes, 600);

    expect(marcos).toEqual([
      { periodo: 1, cargaHorariaAcumulada: 60, percentual: 10 },
    ]);
  });

  it('orders marcos by período regardless of input order', () => {
    const componentes = [
      componente({ codigo: 'B1', periodo: 2, cargaHoraria: 50 }),
      componente({ codigo: 'A1', periodo: 1, cargaHoraria: 50 }),
    ];

    const marcos = calcularMarcos(componentes, 100);

    expect(marcos.map((m) => m.periodo)).toEqual([1, 2]);
  });

  it('returns an empty list when no componente carries a período', () => {
    const componentes = [
      componente({ codigo: 'OP1', periodo: null, natureza: 'OPTATIVA' }),
    ];

    expect(calcularMarcos(componentes, 100)).toEqual([]);
  });
});

describe('compararRitmo', () => {
  const marcos: MarcoSemestre[] = [
    { periodo: 1, cargaHorariaAcumulada: 100, percentual: 10 },
    { periodo: 2, cargaHorariaAcumulada: 250, percentual: 25 },
    { periodo: 3, cargaHorariaAcumulada: 400, percentual: 40 },
  ];

  it('reports atrasado when integralizada trails the current período’s marco', () => {
    expect(compararRitmo(marcos, 2, 200)).toBe('atrasado');
  });

  it('reports adiantado when integralizada beats the current período’s marco', () => {
    expect(compararRitmo(marcos, 2, 300)).toBe('adiantado');
  });

  it('reports no_ritmo when integralizada matches the current período’s marco exactly', () => {
    expect(compararRitmo(marcos, 2, 250)).toBe('no_ritmo');
  });

  it('falls back to the last marco when periodoAlvo exceeds the grade', () => {
    expect(compararRitmo(marcos, 10, 350)).toBe('atrasado');
  });

  it('returns null when the grade has no marcos at all', () => {
    expect(compararRitmo([], 2, 100)).toBeNull();
  });

  it('compares against a zero baseline when periodoAlvo is before the grade’s first marco', () => {
    // A student still on their first período (nothing fechado yet, periodoAlvo
    // 0) is adiantado the moment they have any integralizada at all — falling
    // back to the LAST marco here would wrongly call them atrasado instead.
    expect(compararRitmo(marcos, 0, 1)).toBe('adiantado');
  });

  it('reports no_ritmo at the zero baseline when nothing has been integralizado yet', () => {
    expect(compararRitmo(marcos, 0, 0)).toBe('no_ritmo');
  });
});

describe('classificarComponente', () => {
  it('reports atual when the código is still on the active grade', () => {
    const ativos = [componente({ codigo: 'FISD36' })];

    expect(classificarComponente('FISD36', ativos)).toEqual({
      status: 'atual',
    });
  });

  it('reports equivalente when an active componente lists the código in its equivalências', () => {
    const ativos = [
      componente({
        codigo: 'ENG295B',
        equivalencias: '(ENG295A) OU (ENG295B)',
      }),
    ];

    expect(classificarComponente('ENG295A', ativos)).toEqual({
      status: 'equivalente',
      equivalenteDe: 'ENG295B',
    });
  });

  it('reports obsoleta when the código is on neither the grade nor any equivalência', () => {
    const ativos = [componente({ codigo: 'FISD36', equivalencias: null })];

    expect(classificarComponente('MATZ00', ativos)).toEqual({
      status: 'obsoleta',
    });
  });

  it('does not match a código that only appears as a substring of another', () => {
    const ativos = [
      componente({ codigo: 'ENG295B', equivalencias: '(ENG295AB)' }),
    ];

    expect(classificarComponente('ENG295A', ativos)).toEqual({
      status: 'obsoleta',
    });
  });
});

function estrutura(
  componentes: ComponenteCurricularSalvo[],
): EstruturaCurricularSalva {
  return {
    idSigaa: '1',
    codigo: 'G20251',
    anoPeriodoImplementacao: '2025.1',
    cargaHorariaTotal: 1000,
    cargaHorariaObrigatoria: 900,
    cargaHorariaOptativaMinima: 100,
    cargaHorariaComplementarMinima: 0,
    prazoMinimoSemestres: 8,
    prazoMedioSemestres: 10,
    prazoMaximoSemestres: 16,
    fetchedAt: new Date('2026-01-01'),
    staleAfter: new Date('2027-01-01'),
    componentes,
  };
}

function historico(overrides: Partial<Historico> = {}): Historico {
  return {
    emitidoEm: '2026-08-19',
    curriculo: 'G20251 - 2025.2',
    nomeCurso: 'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR',
    periodoLetivoAtual: 2,
    prazoConclusaoPadrao: '2030.1',
    prazoConclusaoMaximo: '2033.1',
    indices: { cr: null, iap: null },
    cursados: [],
    pendentesObrigatorios: [],
    cargaHoraria: {
      obrigatorias: { exigida: 250, integralizada: 200, pendente: 50 },
      optativas: { exigida: 0, integralizada: 0, pendente: 0 },
      complementares: { exigida: 0, integralizada: 0, pendente: 0 },
      total: { exigida: 1000, integralizada: 200, pendente: 800 },
    },
    equivalencias: [],
    observacoes: [],
    ...overrides,
  };
}

describe('montarMarcosResponse', () => {
  it('composes marcos, ritmo and componente classification from the active grade and o histórico', () => {
    const ativos = estrutura([
      componente({ codigo: 'A1', periodo: 1, cargaHoraria: 100 }),
      componente({ codigo: 'B1', periodo: 2, cargaHoraria: 150 }),
    ]);
    const hist = historico({
      cursados: [
        {
          semestre: '2023.1',
          natureza: 'OB',
          codigo: 'A1',
          nome: 'A1',
          cargaHoraria: 100,
          nota: 8,
          situacao: 'APR',
          docente: null,
        },
        {
          semestre: '2023.2',
          natureza: 'OB',
          codigo: 'VELHA1',
          nome: 'VELHA',
          cargaHoraria: 60,
          nota: 7,
          situacao: 'APR',
          docente: null,
        },
      ],
      pendentesObrigatorios: [
        { codigo: 'B1', nome: 'B1', cargaHoraria: 150, matriculado: false },
      ],
    });

    const resposta = montarMarcosResponse(ativos, hist);

    // percentual escala contra cargaHoraria.obrigatorias.exigida (250) — a
    // barra de obrigatórias tem escala própria, não a do currículo inteiro.
    expect(resposta.marcos).toEqual([
      { periodo: 1, cargaHorariaAcumulada: 100, percentual: 40 },
      { periodo: 2, cargaHorariaAcumulada: 250, percentual: 100 },
    ]);
    // periodoLetivoAtual é 2 (o corrente, ainda em andamento) — compararRitmo
    // usa período 1 (o último já fechado): integralizada=200 > marco do
    // período 1 (100), então adiantado.
    expect(resposta.ritmo).toBe('adiantado');
    expect(resposta.obsoletas).toEqual(['VELHA1']);
    expect(resposta.equivalencias).toEqual([]);
  });

  it('lists a componente as equivalência instead of obsoleta when the active grade names it', () => {
    const ativos = estrutura([
      componente({ codigo: 'NOVA1', periodo: 1, equivalencias: '(VELHA1)' }),
    ]);
    const hist = historico({
      cursados: [
        {
          semestre: '2023.1',
          natureza: 'OB',
          codigo: 'VELHA1',
          nome: 'VELHA',
          cargaHoraria: 60,
          nota: 7,
          situacao: 'APR',
          docente: null,
        },
      ],
    });

    const resposta = montarMarcosResponse(ativos, hist);

    expect(resposta.obsoletas).toEqual([]);
    expect(resposta.equivalencias).toEqual([
      { codigo: 'VELHA1', equivalenteDe: 'NOVA1' },
    ]);
  });
});
