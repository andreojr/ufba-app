import { Prisma } from '@prisma/client';
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

// Linhas de `matricula` como o Prisma as devolveria de um `findMany({
// include: { turma: true } })` — cada uma carrega a turma completa, já com
// o `id` e o `numero` reais que só existem depois do upsert em `salvar`.
function matriculasFalsas() {
  return [
    {
      ordem: 0,
      turma: {
        id: 'turma-1',
        codigo: 'MATA37',
        numero: '01',
        nome: 'CÁLCULO A',
        docente: 'DR. ALGUEM',
        semestre: '2026.2',
        vigenciaInicio: '2026-08-19',
        vigenciaFim: '2026-12-19',
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
      },
    },
    {
      ordem: 1,
      turma: {
        id: 'turma-2',
        codigo: null,
        numero: '02',
        nome: 'REDES DE COMPUTADORES',
        docente: null,
        semestre: '2026.2',
        vigenciaInicio: '2026-08-19',
        vigenciaFim: '2026-12-19',
        slots: [],
      },
    },
  ];
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

    // Busca pela chamada de MATA37 em vez de assumir a posição: `salvar`
    // agora ordena as turmas pela chave natural antes de gravar (para que
    // escritores concorrentes peguem locks na mesma ordem global), então a
    // ordem das chamadas de upsert não é mais a ordem do atestado.
    const chamadaCalculoA = tx.turma.upsert.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chamada: any) =>
        chamada[0].where.semestre_codigo_numero.codigo === 'MATA37',
    );
    expect(chamadaCalculoA?.[0].update.nome).toBe('CÁLCULO A');
  });

  it('não sobrescreve quando o registro tem exatamente o mesmo instante do sync', async () => {
    // `>=` na guarda é proposital: um empate significa que já existe um
    // registro tão novo quanto este fetch, então não há dado mais recente
    // para aplicar.
    const empate = new Date('2026-08-23T12:00:00Z');
    const { prisma, tx } = prismaFalso({ atualizadoEm: empate });

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
      empate,
    );

    expect(tx.turma.upsert.mock.calls[0][0].update).toEqual({});
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

  it('tenta de novo e tem sucesso quando um P2002 vem de dois alunos sincronizando a mesma turma ao mesmo tempo', async () => {
    // Dois `findUnique` concorrentes veem null e os dois tentam criar a
    // mesma turma; um leva P2002 e a transação inteira aborta. A gravação
    // não pode virar um 500 pro aluno que só perdeu a corrida por
    // milissegundos — vale tentar de novo.
    const conflito = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`semestre`,`codigo`,`numero`)',
      { code: 'P2002', clientVersion: '6.0.0' },
    );
    const { prisma, tx } = prismaFalso();
    let tentativas = 0;
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (t: typeof tx) => Promise<void>) => {
        tentativas += 1;
        if (tentativas === 1) {
          throw conflito;
        }
        return fn(tx);
      },
    );

    await new PrismaScheduleRepository(prisma).salvar(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
      new Date('2026-08-23T12:00:00Z'),
    );

    expect(tentativas).toBe(2);
  });

  it('reports null when the user has never synced', async () => {
    const prisma = {
      cachedSchedule: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prisma).buscar('user-1');

    expect(salvo).toBeNull();
  });

  it('busca as turmas matriculadas com id e numero reais, na ordem do aluno', async () => {
    const findMany = jest.fn(async () => matriculasFalsas());
    const prisma = {
      cachedSchedule: {
        findUnique: jest.fn(async () => ({
          periodoLetivoSemestre: periodoLetivo.semestre,
          periodoLetivoInicio: periodoLetivo.inicio,
          periodoLetivoFim: periodoLetivo.fim,
          fetchedAt: new Date('2026-08-23T12:00:00Z'),
        })),
      },
      matricula: { findMany },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prisma).buscar('user-1');

    // A ordem, o id e o numero são exatamente o que essa feature depende:
    // sem eles a tela de pontos de atenção não sabe qual Turma é qual.
    expect(salvo?.turmas).toEqual(
      turmasFalsas().map((t, i) => ({ ...t, id: `turma-${i + 1}` })),
    );
    expect(salvo?.periodoLetivo).toEqual(periodoLetivo);
    expect(salvo?.fetchedAt).toEqual(new Date('2026-08-23T12:00:00Z'));
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { ordem: 'asc' },
      include: { turma: true },
    });
  });

  it('reports periodoLetivo as null when the term fields are unset', async () => {
    const prisma = {
      cachedSchedule: {
        findUnique: jest.fn(async () => ({
          periodoLetivoSemestre: null,
          periodoLetivoInicio: null,
          periodoLetivoFim: null,
          fetchedAt: new Date('2026-08-23T12:00:00Z'),
        })),
      },
      matricula: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;

    const salvo = await new PrismaScheduleRepository(prisma).buscar('user-1');

    expect(salvo?.periodoLetivo).toBeNull();
  });
});
