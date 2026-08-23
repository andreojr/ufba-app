import type { Historico } from '../sigaa-engine/parsers/historico';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import type { MarcosResponse } from './marcos-semestralizacao';
import { derramarHorasGenericas, montarProjecao } from './projecao-trajetoria';

const SEM_MARCOS: MarcosResponse = {
  marcos: [],
  ritmo: null,
  obsoletas: [],
  equivalencias: [],
};

function estrutura(
  componentes: EstruturaCurricularSalva['componentes'],
): EstruturaCurricularSalva {
  return {
    idSigaa: 'E1',
    codigo: 'G20251',
    anoPeriodoImplementacao: '2025.1',
    cargaHorariaTotal: 3000,
    cargaHorariaObrigatoria: 2400,
    cargaHorariaOptativaMinima: 360,
    cargaHorariaComplementarMinima: 240,
    prazoMinimoSemestres: 8,
    prazoMedioSemestres: 10,
    prazoMaximoSemestres: 14,
    fetchedAt: new Date('2026-08-01'),
    staleAfter: new Date('2026-09-01'),
    componentes,
  };
}

function componente(
  codigo: string,
  periodo: number | null,
  cargaHoraria = 60,
): EstruturaCurricularSalva['componentes'][number] {
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

function historico(parcial: Partial<Historico> = {}): Historico {
  return {
    emitidoEm: '2026-08-01',
    curriculo: 'G20251 - 2025.1',
    nomeCurso: 'CIÊNCIA DA COMPUTAÇÃO',
    periodoLetivoAtual: 3,
    prazoConclusaoPadrao: '2027.2',
    prazoConclusaoMaximo: '2029.2',
    indices: { cr: 8, iap: 8 },
    cursados: [
      {
        semestre: '2026.1',
        natureza: 'OB',
        codigo: 'A',
        nome: 'A',
        cargaHoraria: 120,
        nota: 8,
        situacao: 'APR',
        docente: null,
      },
    ],
    pendentesObrigatorios: [],
    cargaHoraria: {
      obrigatorias: { exigida: 2400, integralizada: 120, pendente: 2280 },
      optativas: { exigida: 360, integralizada: 0, pendente: 0 },
      complementares: { exigida: 240, integralizada: 0, pendente: 0 },
      total: { exigida: 3000, integralizada: 120, pendente: 2880 },
    },
    equivalencias: [],
    observacoes: [],
    ...parcial,
  };
}

describe('derramarHorasGenericas', () => {
  it('usa a folga do semestre antes de abrir um novo', () => {
    const semestres = [
      { semestre: '2026.2', componentes: [], horasOptativas: 0, horasComplementares: 0 },
    ];
    const [primeiro, segundo] = derramarHorasGenericas(semestres, 180, 0, 120, '2026.2');

    expect(primeiro.horasOptativas).toBe(120);
    expect(segundo).toMatchObject({ semestre: '2027.1', horasOptativas: 60 });
  });

  it('desconta o que as obrigatórias já ocupam', () => {
    const semestres = [
      {
        semestre: '2026.2',
        componentes: [
          {
            codigo: 'A',
            nome: 'A',
            cargaHoraria: 90,
            periodo: 1,
            atrasada: false,
            manual: false,
            preRequisitoNaoVerificado: false,
          },
        ],
        horasOptativas: 0,
        horasComplementares: 0,
      },
    ];
    const [primeiro] = derramarHorasGenericas(semestres, 120, 0, 120, '2026.2');

    expect(primeiro.horasOptativas).toBe(30);
  });

  it('abre semestres do zero quando só faltam horas genéricas', () => {
    const semestres = derramarHorasGenericas([], 0, 200, 120, '2026.2');

    expect(semestres.map((s) => s.horasComplementares)).toEqual([120, 80]);
    expect(semestres.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
  });

  it('não mexe em nada quando não falta hora genérica', () => {
    const semestres = [
      { semestre: '2026.2', componentes: [], horasOptativas: 0, horasComplementares: 0 },
    ];
    expect(derramarHorasGenericas(semestres, 0, 0, 120, '2026.2')).toEqual(semestres);
  });

  it('despeja tudo num semestre vazio quando o teto é degenerado (zero)', () => {
    const semestres = derramarHorasGenericas([], 120, 60, 0, '2026.2');

    const totalOptativas = semestres.reduce((soma, s) => soma + s.horasOptativas, 0);
    const totalComplementares = semestres.reduce((soma, s) => soma + s.horasComplementares, 0);
    expect(totalOptativas).toBe(120);
    expect(totalComplementares).toBe(60);
  });
});

describe('montarProjecao', () => {
  it('começa no semestre seguinte ao último do histórico', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 2)]),
      historico({ pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 60, matriculado: false }] }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.semestres[0].semestre).toBe('2026.2');
  });

  it('conta as atrasadas e projeta a conclusão no último semestre', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120), componente('C', 2, 120)]),
      historico({
        periodoLetivoAtual: 3,
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    // Teto = min(período mais pesado da grade (120), recorde do aluno (120)).
    expect(projecao.teto).toBe(120);
    expect(projecao.atrasadas).toBe(2);
    expect(projecao.conclusaoProjetada).toBe('2027.1');
  });

  it('mede o atraso contra o prazo padrão do histórico', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoPadrao: '2026.2',
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    // B em 2026.2, C (obsoleta pura) em 2027.1 — um semestre além do padrão.
    expect(projecao.conclusaoProjetada).toBe('2027.1');
    expect(projecao.semestresAlemDoPrevisto).toBe(1);
    expect(projecao.alemDoPrazoMaximo).toBe(false);
  });

  it('avisa quando a projeção passa do prazo máximo, sem cortar a fila', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoMaximo: '2026.2',
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.alemDoPrazoMaximo).toBe(true);
    // Nada foi cortado: as duas continuam alocadas.
    expect(projecao.semestres.flatMap((s) => s.componentes)).toHaveLength(2);
  });

  it('não conta como além do previsto quem termina antes do prazo', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoPadrao: '2029.1',
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.semestresAlemDoPrevisto).toBe(0);
  });

  it('trata quem cursou o código antigo como tendo o pré-requisito novo', () => {
    const projecao = montarProjecao(
      estrutura([
        componente('NOVA2', 1, 120),
        { ...componente('C', 2, 120), preRequisito: '(NOVA2)' },
      ]),
      historico({
        cursados: [
          {
            semestre: '2026.1',
            natureza: 'OB',
            codigo: 'VELHA2',
            nome: 'VELHA2',
            cargaHoraria: 120,
            nota: 8,
            situacao: 'APR',
            docente: null,
          },
        ],
        pendentesObrigatorios: [{ codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false }],
      }),
      { ...SEM_MARCOS, equivalencias: [{ codigo: 'VELHA2', equivalenteDe: 'NOVA2' }] },
      [],
    );

    // C libera de imediato: VELHA2 satisfaz o pré-requisito escrito como NOVA2.
    expect(projecao.semestres).toHaveLength(1);
    expect(projecao.semestres[0].componentes[0]).toMatchObject({
      codigo: 'C',
      preRequisitoNaoVerificado: false,
    });
  });

  it('respeita o override do aluno', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [{ codigo: 'B', nome: 'B', cargaHoraria: 120, semestre: '2027.2' }],
    );

    const alocado = projecao.semestres.find((s) =>
      s.componentes.some((c) => c.codigo === 'B'),
    );
    expect(alocado?.semestre).toBe('2027.2');
    expect(alocado?.componentes[0].manual).toBe(true);
  });

  it('quem não tem nada pendente conclui no último semestre cursado, não no seguinte', () => {
    const projecao = montarProjecao(estrutura([]), historico(), SEM_MARCOS, []);

    expect(projecao.semestres).toEqual([]);
    expect(projecao.conclusaoProjetada).toBe('2026.1');
  });

  it('ignora override sem semestre — é o pool, não uma posição', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [{ codigo: 'B', nome: 'B', cargaHoraria: 120, semestre: null }],
    );

    expect(projecao.semestres[0].semestre).toBe('2026.2');
    expect(projecao.semestres[0].componentes[0].manual).toBe(false);
  });
});
