import type { Prisma } from '@prisma/client';
import type {
  HorarioSalvo,
  ScheduleRepository,
  TurmaSalva,
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
    fetchedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      for (const turma of turmas) {
        // O cast é seguro: o engine service (Task 2) rejeita a sincronização
        // antes de chegar aqui se alguma turma vier sem código. O tipo do
        // parser segue nulável só por causa de parseTurmasHorario.
        const chave = {
          semestre_codigo_numero: {
            semestre: turma.semestre,
            codigo: turma.codigo as string,
            numero: turma.numero,
          },
        };

        const existente = await tx.turma.findUnique({
          where: chave,
          select: { atualizadoEm: true },
        });

        // Um app que ficou offline com dado velho não pode regredir a sala
        // para toda a turma: só escreve quem chegou com dado mais novo.
        const dados = {
          nome: turma.nome,
          docente: turma.docente,
          vigenciaInicio: turma.vigencia.inicio,
          vigenciaFim: turma.vigencia.fim,
          slots: turma.slots as unknown as Prisma.InputJsonValue,
          atualizadoEm: fetchedAt,
        };
        const desatualizada = existente !== null && existente.atualizadoEm >= fetchedAt;

        const { id } = await tx.turma.upsert({
          where: chave,
          create: {
            semestre: turma.semestre,
            codigo: turma.codigo as string,
            numero: turma.numero,
            ...dados,
          },
          update: desatualizada ? {} : dados,
          select: { id: true },
        });
        ids.push(id);
      }

      await tx.matricula.deleteMany({ where: { userId } });
      await tx.matricula.createMany({
        data: ids.map((turmaId, ordem) => ({ userId, turmaId, ordem })),
      });

      await tx.cachedSchedule.upsert({
        where: { userId },
        create: {
          userId,
          periodoLetivoSemestre: periodoLetivo?.semestre ?? null,
          periodoLetivoInicio: periodoLetivo?.inicio ?? null,
          periodoLetivoFim: periodoLetivo?.fim ?? null,
          fetchedAt,
        },
        update: {
          periodoLetivoSemestre: periodoLetivo?.semestre ?? null,
          periodoLetivoInicio: periodoLetivo?.inicio ?? null,
          periodoLetivoFim: periodoLetivo?.fim ?? null,
          fetchedAt,
        },
      });
    });
  }

  async buscar(userId: string): Promise<HorarioSalvo | null> {
    const registro = await this.prisma.cachedSchedule.findUnique({
      where: { userId },
    });

    if (!registro) {
      return null;
    }

    const matriculas = await this.prisma.matricula.findMany({
      where: { userId },
      orderBy: { ordem: 'asc' },
      include: { turma: true },
    });

    return {
      fetchedAt: registro.fetchedAt,
      periodoLetivo: registro.periodoLetivoSemestre
        ? {
            semestre: registro.periodoLetivoSemestre,
            inicio: registro.periodoLetivoInicio as string,
            fim: registro.periodoLetivoFim as string,
          }
        : null,
      turmas: matriculas.map(({ turma }): TurmaSalva => ({
        id: turma.id,
        codigo: turma.codigo,
        numero: turma.numero,
        nome: turma.nome,
        docente: turma.docente,
        slots: turma.slots as unknown as TurmaSlot[],
        vigencia: { inicio: turma.vigenciaInicio, fim: turma.vigenciaFim },
        semestre: turma.semestre,
      })),
    };
  }
}
