import { PrismaScheduleRepository } from './prisma-schedule.repository';
import type { PrismaService } from './prisma.service';
import type { PeriodoLetivo } from '../sigaa-engine/parsers/atestado-turmas';
import type { Turma } from '../sigaa-engine/parsers/turma';

function turmasFalsas(): Turma[] {
  return [
    {
      codigo: 'MATA37',
      nome: 'CÁLCULO A',
      docente: 'DR. ALGUEM',
      slots: [
        {
          dia: 'SEG',
          inicioMin: 480,
          fimMin: 600,
          predio: 'Pavilhão de Aulas',
          sala: '12',
          localOriginal: 'PAV. AULAS, sala 12',
        },
      ],
      vigencia: { inicio: '2026-08-19', fim: '2026-12-19' },
      semestre: '2026.2',
    },
    {
      codigo: null,
      nome: 'REDES DE COMPUTADORES',
      docente: null,
      slots: [],
      vigencia: { inicio: '2026-08-19', fim: '2026-12-19' },
      semestre: '2026.2',
    },
  ];
}

const periodoLetivo: PeriodoLetivo = {
  semestre: '2026.2',
  inicio: '2026-08-19',
  fim: '2026-12-19',
};

describe('PrismaScheduleRepository', () => {
  it('replaces the previous snapshot inside a single transaction', async () => {
    const operacoes: string[] = [];
    const tx = {
      cachedSchedule: {
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

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
    );

    // Delete before create, both inside the same transaction callback:
    // otherwise a failure mid-write leaves two fetches' turmas mixed together.
    expect(operacoes).toEqual(['delete', 'create']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('preserves each turma at the ordem it was passed in', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dadosCriados: any;
    const tx = {
      cachedSchedule: {
        deleteMany: jest.fn(async () => undefined),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: jest.fn(async (args: any) => {
          dadosCriados = args.data;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
    );

    expect(dadosCriados.turmas.create.map((t: { ordem: number }) => t.ordem)).toEqual([
      0, 1,
    ]);
  });

  it('reads back exactly what salvar wrote', async () => {
    const turmas = turmasFalsas();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dadosCriados: any;
    const tx = {
      cachedSchedule: {
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

    await new PrismaScheduleRepository(prismaEscrita).salvar(
      'user-1',
      turmas,
      periodoLetivo,
    );

    // Feeds buscar's fake findUnique the exact payload salvar's create()
    // received — a round trip through the real mapping code on both sides.
    const prismaLeitura = {
      cachedSchedule: {
        findUnique: jest.fn(async () => ({
          ...dadosCriados,
          turmas: dadosCriados.turmas.create,
          fetchedAt: new Date('2026-08-19T03:35:00Z'),
        })),
      },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prismaLeitura).buscar('user-1');

    expect(salvo?.turmas).toEqual(turmas);
    expect(salvo?.periodoLetivo).toEqual(periodoLetivo);
  });

  it('reports periodoLetivo as null when the fetch degraded to the portal home', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dadosCriados: any;
    const tx = {
      cachedSchedule: {
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

    await new PrismaScheduleRepository(prismaEscrita).salvar(
      'user-1',
      turmasFalsas(),
      null,
    );

    const prismaLeitura = {
      cachedSchedule: {
        findUnique: jest.fn(async () => ({
          ...dadosCriados,
          turmas: dadosCriados.turmas.create,
          fetchedAt: new Date('2026-08-19T03:35:00Z'),
        })),
      },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prismaLeitura).buscar('user-1');

    expect(salvo?.periodoLetivo).toBeNull();
  });

  it('reports null when the user has never synced', async () => {
    const prisma = {
      cachedSchedule: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prisma).buscar('user-1');

    expect(salvo).toBeNull();
  });
});
