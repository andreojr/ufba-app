import { PrismaScheduleRepository } from './prisma-schedule.repository';
import type { PrismaService } from './prisma.service';
import type { PeriodoLetivo } from '../sigaa-engine/parsers/atestado-turmas';
import type { Turma } from '../sigaa-engine/parsers/turma';

function turmasFalsas(): Turma[] {
  return [
    {
      codigo: 'MATA37',
      nome: 'CÁLCULO A',
      numero: '01',
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
      numero: '02',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prismaFalso(overrides: { atualizadoEm?: Date } = {}) {
  const upserts: any[] = [];
  const tx = {
    turma: {
      findUnique: jest.fn(async () =>
        overrides.atualizadoEm ? { id: 'turma-1', atualizadoEm: overrides.atualizadoEm } : null,
      ),
      upsert: jest.fn(async (args: any) => {
        upserts.push(args);
        return { id: 'turma-1' };
      }),
    },
    matricula: {
      deleteMany: jest.fn(async () => undefined),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createMany: jest.fn(async (_args: any) => undefined),
    },
    cachedSchedule: { upsert: jest.fn(async () => undefined) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, tx, upserts };
}

describe('PrismaScheduleRepository', () => {
  it('não sobrescreve uma turma que outro aluno sincronizou depois', async () => {
    const { prisma, tx } = prismaFalso({ atualizadoEm: new Date('2026-08-23T12:00:00Z') });

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
      new Date('2026-08-23T09:00:00Z'),
    );

    // O upsert acontece (a matrícula precisa do id), mas sem update dos dados.
    expect(tx.turma.upsert.mock.calls[0][0].update).toEqual({});
  });

  it('sobrescreve quando o sync é mais recente que o registro', async () => {
    const { prisma, tx } = prismaFalso({ atualizadoEm: new Date('2026-08-23T09:00:00Z') });

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
      new Date('2026-08-23T12:00:00Z'),
    );

    expect(tx.turma.upsert.mock.calls[0][0].update.nome).toBe('CÁLCULO A');
  });

  it('substitui as matrículas do aluno preservando a ordem do SIGAA', async () => {
    const { prisma, tx } = prismaFalso();

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
      new Date('2026-08-23T12:00:00Z'),
    );

    expect(tx.matricula.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.matricula.createMany.mock.calls[0][0].data.map((m: any) => m.ordem)).toEqual([
      0, 1,
    ]);
  });

  it('reports null when the user has never synced', async () => {
    const prisma = {
      cachedSchedule: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prisma).buscar('user-1');

    expect(salvo).toBeNull();
  });
});
