import type { Prisma } from '@prisma/client';
import type {
  HorarioSalvo,
  ScheduleRepository,
} from '../sigaa-engine/schedule.repository';
import type { PeriodoLetivo } from '../sigaa-engine/parsers/atestado-turmas';
import type { Turma, TurmaSlot } from '../sigaa-engine/parsers/turma';
import { PrismaService } from './prisma.service';

export class PrismaScheduleRepository implements ScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async salvar(
    userId: string,
    turmas: Turma[],
    periodoLetivo: PeriodoLetivo | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Turmas cascade off cachedSchedule, so one delete clears the whole
      // snapshot.
      await tx.cachedSchedule.deleteMany({ where: { userId } });
      await tx.cachedSchedule.create({
        data: {
          userId,
          periodoLetivoSemestre: periodoLetivo?.semestre ?? null,
          periodoLetivoInicio: periodoLetivo?.inicio ?? null,
          periodoLetivoFim: periodoLetivo?.fim ?? null,
          turmas: {
            create: turmas.map((turma, ordem) => ({
              ordem,
              codigo: turma.codigo,
              nome: turma.nome,
              docente: turma.docente,
              semestre: turma.semestre,
              vigenciaInicio: turma.vigencia.inicio,
              vigenciaFim: turma.vigencia.fim,
              slots: turma.slots as unknown as Prisma.InputJsonValue,
            })),
          },
        },
      });
    });
  }

  async buscar(userId: string): Promise<HorarioSalvo | null> {
    const registro = await this.prisma.cachedSchedule.findUnique({
      where: { userId },
      include: { turmas: { orderBy: { ordem: 'asc' } } },
    });

    if (!registro) {
      return null;
    }

    return {
      fetchedAt: registro.fetchedAt,
      periodoLetivo: registro.periodoLetivoSemestre
        ? {
            semestre: registro.periodoLetivoSemestre,
            inicio: registro.periodoLetivoInicio as string,
            fim: registro.periodoLetivoFim as string,
          }
        : null,
      turmas: registro.turmas.map((t): Turma => ({
        codigo: t.codigo,
        nome: t.nome,
        docente: t.docente,
        slots: t.slots as unknown as TurmaSlot[],
        vigencia: { inicio: t.vigenciaInicio, fim: t.vigenciaFim },
        semestre: t.semestre,
      })),
    };
  }
}
