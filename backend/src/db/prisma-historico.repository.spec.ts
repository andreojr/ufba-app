import { PrismaHistoricoRepository } from './prisma-historico.repository';
import type { PrismaService } from './prisma.service';
import type { Historico } from '../sigaa-engine/parsers/historico';

function historicoMinimo(): Historico {
  return {
    emitidoEm: '2026-08-19',
    curriculo: 'G20251 - 2025.2',
    periodoLetivoAtual: 8,
    prazoConclusaoPadrao: '2030.1',
    prazoConclusaoMaximo: '2033.1',
    indices: { cr: 8.1597, iap: 0.8434 },
    cursados: [
      {
        semestre: '2023.1',
        natureza: 'OB',
        codigo: 'FISD36',
        nome: 'FÍSICA',
        cargaHoraria: 60,
        nota: 6.8,
        situacao: 'APR',
        docente: 'DR. ALGUEM (60h)',
      },
    ],
    pendentesObrigatorios: [
      { codigo: 'MATA59', nome: 'REDES', cargaHoraria: 60, matriculado: true },
    ],
    cargaHoraria: {
      obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
      optativas: { exigida: 360, integralizada: 0, pendente: 360 },
      complementares: { exigida: 100, integralizada: 0, pendente: 100 },
      total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
    },
    equivalencias: [],
    observacoes: [],
  };
}

describe('PrismaHistoricoRepository', () => {
  it('replaces the previous snapshot inside a single transaction, touching no plano row', async () => {
    const operacoes: string[] = [];
    const tx = {
      historico: {
        deleteMany: jest.fn(async () => {
          operacoes.push('delete');
        }),
        create: jest.fn(async () => {
          operacoes.push('create');
        }),
      },
      // Exposed so a stray call is an assertion failure, not just a TypeError
      // the test happens not to hit: salvar must never touch planoItem, since
      // the plan is authored data that has to outlive the snapshot.
      planoItem: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).salvar('user-1', historicoMinimo());

    // Delete before create, and both inside the same transaction callback:
    // otherwise a failure mid-write leaves two documents' rows mixed together.
    expect(operacoes).toEqual(['delete', 'create']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.planoItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.planoItem.create).not.toHaveBeenCalled();
    expect(tx.planoItem.upsert).not.toHaveBeenCalled();
  });

  it('reads back exactly what salvar wrote', async () => {
    const historico = historicoMinimo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dadosCriados: any;
    const tx = {
      historico: {
        deleteMany: jest.fn(async () => undefined),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn(async (args: any) => {
          dadosCriados = args.data;
        }),
      },
    };
    const prismaEscrita = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prismaEscrita).salvar('user-1', historico);

    // Feeds buscar's fake findUnique the exact payload salvar's create()
    // received — a round trip through the real mapping code on both sides,
    // not two mappings independently asserted against the same fixture.
    const prismaLeitura = {
      historico: {
        findUnique: jest.fn(async () => ({
          ...dadosCriados,
          componentes: dadosCriados.componentes.create,
          pendentes: dadosCriados.pendentes.create,
          fetchedAt: new Date('2026-08-19T03:35:00Z'),
        })),
      },
      planoItem: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;

    const salva = await new PrismaHistoricoRepository(prismaLeitura).buscar('user-1');

    expect(salva?.historico).toEqual(historico);
  });

  it('drops only the plan items whose component actually concluded', async () => {
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const prisma = { planoItem: { deleteMany } } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).reconciliarPlano('user-1', [
      'FISD36',
    ]);

    // `in`, not `notIn`: an empty concluded list (nothing finished this sync)
    // must delete nothing, which `in: []` guarantees and `notIn: []` does not.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', codigo: { in: ['FISD36'] } },
    });
  });

  it('reports null when the user has never synced', async () => {
    const prisma = {
      historico: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;

    const salva = await new PrismaHistoricoRepository(prisma).buscar('user-1');

    expect(salva).toBeNull();
  });
});
