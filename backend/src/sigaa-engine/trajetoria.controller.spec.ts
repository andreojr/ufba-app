import { TrajetoriaController } from './trajetoria.controller';
import type { HistoricoService } from './historico.service';
import type { TrajetoriaSalva } from './historico.repository';
import type { CurriculoService } from '../curriculo/curriculo.service';
import { CursoDesconhecidoError } from '../curriculo/curriculo.service';
import type { EstruturaCurricularSalva } from '../curriculo/curriculo.repository';

// All three fields: RequestUser requires `name` too, and these specs pass the
// object with no cast — matching sigaa.controller.spec.ts's convention.
const USUARIO = { userId: 'user-1', email: 'maria@example.com', name: 'Maria' };

function salvaFalsa(
  overrides: Partial<TrajetoriaSalva['historico']> = {},
): TrajetoriaSalva {
  return {
    historico: {
      nomeCurso: 'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR',
      periodoLetivoAtual: 1,
      // A projeção agora sai junto dos marcos (Task 6), então mesmo fixtures
      // que só testam marcos precisam desses dois campos preenchidos —
      // sem eles montarProjecao lança ao tentar fatiar undefined.
      prazoConclusaoPadrao: '2026.2',
      prazoConclusaoMaximo: '2030.2',
      indices: { cr: 8.1597, iap: 0.8434 },
      cursados: [],
      pendentesObrigatorios: [],
      cargaHoraria: {
        // marcos' percentual now scales against obrigatorias.exigida, not
        // total.exigida (see marcos-semestralizacao.ts) — kept equal to total
        // here since this fixture has no optativas/complementares of its own.
        obrigatorias: { exigida: 1000, integralizada: 100, pendente: 900 },
        optativas: { exigida: 0, integralizada: 0, pendente: 0 },
        complementares: { exigida: 0, integralizada: 0, pendente: 0 },
        total: { exigida: 1000, integralizada: 100, pendente: 900 },
      },
      ...overrides,
    } as TrajetoriaSalva['historico'],
    fetchedAt: new Date('2026-08-19T03:35:00Z'),
    plano: [],
  };
}

function estruturaFalsa(): EstruturaCurricularSalva {
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
    componentes: [
      {
        idSigaa: 'A1',
        codigo: 'A1',
        nome: 'A1',
        cargaHoraria: 100,
        natureza: 'OBRIGATORIA',
        periodo: 1,
        unidadeResponsavel: null,
        preRequisito: null,
        coRequisito: null,
        equivalencias: null,
      },
    ],
  };
}

describe('TrajetoriaController', () => {
  it('reports the unsynced state instead of an error when nothing is stored', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => null),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(),
    } as unknown as CurriculoService;

    // The screen's fallback state is a normal outcome, not a failure: a brand
    // new user has simply never pressed the sync button.
    await expect(
      new TrajetoriaController(service, curriculo).get(USUARIO),
    ).resolves.toEqual({ sincronizado: false });
  });

  it('serialises fetchedAt as an ISO string so the client can show staleness', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => estruturaFalsa()),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).get(
      USUARIO,
    );

    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });

  it('returns the freshly synced aggregate, sparing the client a second call', async () => {
    const service = {
      getTrajetoria: jest.fn(),
      sync: jest.fn(async () => salvaFalsa()),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => estruturaFalsa()),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).sync(
      USUARIO,
      {
        login: '209900011',
        senha: 'segredo',
      },
    );

    expect(service.sync).toHaveBeenCalledWith('user-1', {
      login: '209900011',
      senha: 'segredo',
    });
    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });

  it('includes the marcos de semestralização when the curso resolves', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => estruturaFalsa()),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).get(
      USUARIO,
    );

    expect(resposta).toMatchObject({
      marcos: {
        marcos: [{ periodo: 1, cargaHorariaAcumulada: 100, percentual: 10 }],
        // salvaFalsa's periodoLetivoAtual is 1 (the corrente, still in
        // progress) — compararRitmo compares against período 0 instead,
        // below the grade's first marco, so a zero baseline: integralizada
        // 100 > 0 é adiantado.
        ritmo: 'adiantado',
        obsoletas: [],
        equivalencias: [],
      },
    });
    expect(curriculo.resolverPorNomeUsuario).toHaveBeenCalledWith(
      'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR',
    );
  });

  it('omits marcos, without failing the whole response, when the curso cannot be resolved', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => {
        throw new CursoDesconhecidoError('curso desconhecido');
      }),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).get(
      USUARIO,
    );

    expect(resposta).toMatchObject({ marcos: null });
  });

  it('devolve a projeção junto dos marcos', async () => {
    const service = {
      getTrajetoria: jest.fn(async () =>
        salvaFalsa({
          pendentesObrigatorios: [
            { codigo: 'A1', nome: 'A1', cargaHoraria: 100, matriculado: false },
          ],
        }),
      ),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => estruturaFalsa()),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).get(
      USUARIO,
    );

    expect(resposta).toMatchObject({ projecao: expect.any(Object) });
    if (!('projecao' in resposta) || resposta.projecao === null) {
      throw new Error('esperava projeção');
    }
    expect(resposta.projecao.semestres.length).toBeGreaterThan(0);
  });

  it('degrada para projecao null quando a estrutura não resolve, sem derrubar o resto', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => {
        throw new CursoDesconhecidoError('curso desconhecido');
      }),
    } as unknown as CurriculoService;

    const resposta = await new TrajetoriaController(service, curriculo).get(
      USUARIO,
    );

    expect(resposta).toMatchObject({ marcos: null, projecao: null });
    // O histórico continua lá: a projeção é extra, nunca motivo de falha.
    expect('historico' in resposta && resposta.historico).toBeTruthy();
  });

  it('PUT /trajetoria/plano grava e devolve a trajetória reprojetada', async () => {
    const itens = [
      { codigo: 'MATA55', nome: 'SO', cargaHoraria: 68, semestre: '2027.1' },
    ];
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
      salvarPlano: jest.fn(async () => undefined),
    } as unknown as HistoricoService;
    const curriculo = {
      resolverPorNomeUsuario: jest.fn(async () => estruturaFalsa()),
    } as unknown as CurriculoService;
    const controller = new TrajetoriaController(service, curriculo);

    const resposta = await controller.salvarPlano(USUARIO, { itens });

    expect(service.salvarPlano).toHaveBeenCalledWith('user-1', itens);
    expect('historico' in resposta).toBe(true);
  });
});
