import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { Turma } from './parsers/turma';

export interface HorarioSalvo {
  turmas: Turma[];
  periodoLetivo: PeriodoLetivo | null;
  fetchedAt: Date;
}

export interface ScheduleRepository {
  /**
   * Replaces the user's whole snapshot in one transaction. The fetch is the
   * complete state for the term, so a partial write would mix two fetches'
   * turmas together.
   */
  salvar(
    userId: string,
    turmas: Turma[],
    periodoLetivo: PeriodoLetivo | null,
  ): Promise<void>;

  /** Null when the user has never synced — the screen's fallback state. */
  buscar(userId: string): Promise<HorarioSalvo | null>;
}
