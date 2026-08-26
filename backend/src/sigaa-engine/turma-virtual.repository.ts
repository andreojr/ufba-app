/** Just enough to look up the persisted Turma Virtual token by turma id. */
export interface TurmaVirtualRepository {
  buscarToken(turmaId: string): Promise<{ frontEndIdTurma: string | null } | null>;
}
