import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { Turma } from './parsers/turma';

/** Uma turma já persistida — o `id` é o que a tela de cadastro de pontos usa. */
export type TurmaSalva = Turma & { id: string };

export interface HorarioSalvo {
  turmas: TurmaSalva[];
  periodoLetivo: PeriodoLetivo | null;
  fetchedAt: Date;
}

export interface ScheduleRepository {
  /**
   * Faz upsert das turmas (globais, compartilhadas entre alunos) e substitui
   * as matrículas deste aluno, numa transação. `fetchedAt` decide se os dados
   * da turma sobrescrevem os que já estão lá — ver a guarda de atualizadoEm.
   */
  salvar(
    userId: string,
    turmas: Turma[],
    periodoLetivo: PeriodoLetivo | null,
    fetchedAt: Date,
  ): Promise<void>;

  buscar(userId: string): Promise<HorarioSalvo | null>;
}
