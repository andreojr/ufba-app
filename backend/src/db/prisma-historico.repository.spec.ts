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
  it('replaces the previous snapshot inside a single transaction', async () => {
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
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).salvar('user-1', historicoMinimo());

    // Delete before create, and both inside the same transaction callback:
    // otherwise a failure mid-write leaves two documents' rows mixed together.
    expect(operacoes).toEqual(['delete', 'create']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('drops only the plan items whose component is no longer pending', async () => {
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const prisma = { planoItem: { deleteMany } } as unknown as PrismaService;

    await new PrismaHistoricoRepository(prisma).reconciliarPlano('user-1', [
      'MATA59',
      'MATA60',
    ]);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', codigo: { notIn: ['MATA59', 'MATA60'] } },
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
