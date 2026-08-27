import type { ArgumentMetadata } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { PIPES_METADATA } from '@nestjs/common/constants';
import {
  LIMITE_CURRICULO_MS,
  TrajetoriaController,
} from './trajetoria.controller';
import type { HistoricoService } from './historico.service';
import type { TrajetoriaSalva } from './historico.repository';
import { SalvarPlanoDto } from './plano.dto';
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
      // que só testam marcos precisam desses campos preenchidos —
      // sem eles montarProjecao lança ao tentar fatiar undefined. `emitidoEm`
      // entra na conta porque é dele que sai o primeiro semestre projetado de
      // quem ainda não cursou nada.
      emitidoEm: '2026-08-19',
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

  it('não deixa um currículo lento estourar o orçamento de tempo da resposta', async () => {
    // O caso de produção: num curso de cache frio, `resolverCurso` faz o
    // scraping sequencial do detalhe de *todos* os componentes da estrutura e
    // levou 37s, empurrando o /trajetoria/sync pra 44s contra os 45s de
    // timeout do cliente. Marcos e projeção são extras best-effort — degradar
    // pra null é o que este mesmo método já faz quando a estrutura falha, e
    // vale muito mais que uma resposta que o app abandona no meio.
    jest.useFakeTimers();
    try {
      const service = {
        getTrajetoria: jest.fn(() => Promise.resolve(salvaFalsa())),
        sync: jest.fn(),
      } as unknown as HistoricoService;
      const curriculo = {
        // Nunca resolve, no horizonte do teste: é o scraping ainda rodando.
        resolverPorNomeUsuario: jest.fn(() => new Promise<never>(() => {})),
      } as unknown as CurriculoService;

      const resposta = new TrajetoriaController(service, curriculo).get(
        USUARIO,
      );
      await jest.advanceTimersByTimeAsync(LIMITE_CURRICULO_MS + 1);

      await expect(resposta).resolves.toMatchObject({
        marcos: null,
        projecao: null,
      });
    } finally {
      jest.useRealTimers();
    }
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

  // Os dois testes abaixo provam o comportamento do ValidationPipe em
  // isolamento (semestre malformado é rejeitado, bem formado passa) — mas
  // instanciam o pipe à mão e chamam `.transform()` direto, sem tocar no
  // TrajetoriaController. Se alguém apagar o @UsePipes(...) do controller
  // amanhã, estes dois continuam verdes: eles não sabem que o controller
  // existe. Quem fecha esse buraco é o teste seguinte ("mantém o
  // ValidationPipe ligado no controller"), que lê a metadata do decorator —
  // as duas metades juntas são necessárias, nenhuma sozinha basta.
  it('o ValidationPipe do controller rejeita um semestre fora do formato AAAA.N', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const metadata: ArgumentMetadata = { type: 'body', metatype: SalvarPlanoDto };

    await expect(
      pipe.transform(
        {
          itens: [
            { codigo: 'X', nome: 'Y', cargaHoraria: 1, semestre: 'lixo' },
          ],
        },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it('o ValidationPipe do controller aceita um semestre bem formado', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const metadata: ArgumentMetadata = { type: 'body', metatype: SalvarPlanoDto };

    const resultado = await pipe.transform(
      {
        itens: [
          { codigo: 'X', nome: 'Y', cargaHoraria: 1, semestre: '2027.1' },
        ],
      },
      metadata,
    );

    expect(resultado.itens[0].semestre).toBe('2027.1');
  });

  it('o ValidationPipe do controller aceita o semestre null, que tira do plano', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const metadata: ArgumentMetadata = { type: 'body', metatype: SalvarPlanoDto };

    const resultado = await pipe.transform(
      { itens: [{ codigo: 'X', nome: 'Y', cargaHoraria: 1, semestre: null }] },
      metadata,
    );

    expect(resultado.itens[0].semestre).toBeNull();
  });

  it('o ValidationPipe do controller rejeita um item sem a chave semestre', async () => {
    // Com `@IsOptional` isto passava, e aí `semestre === null` era falso: o
    // item escapava do deleteMany e chegava ao upsert com `undefined`. Tirar
    // do plano tem que ser dito com `null`, não com omissão.
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const metadata: ArgumentMetadata = { type: 'body', metatype: SalvarPlanoDto };

    await expect(
      pipe.transform({ itens: [{ codigo: 'X', nome: 'Y', cargaHoraria: 1 }] }, metadata),
    ).rejects.toThrow();
  });

  // Fecha o buraco que os dois testes acima deixam em aberto: prova que o
  // ValidationPipe está de fato pendurado no TrajetoriaController via
  // @UsePipes, não só que a classe ValidationPipe funciona isoladamente. Sem
  // este teste, apagar o @UsePipes(...) do controller não quebraria nada
  // nesta suíte.
  it('mantém o ValidationPipe ligado no controller', () => {
    const pipes = Reflect.getMetadata(PIPES_METADATA, TrajetoriaController) ?? [];

    expect(
      pipes.some((pipe: unknown) => pipe instanceof ValidationPipe),
    ).toBe(true);
  });
});
