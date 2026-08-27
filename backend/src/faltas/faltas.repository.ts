/**
 * As faltas moram na matrícula (aluno × turma), não na turma: é um contador
 * pessoal que o aluno mantém à mão, e duas pessoas da mesma turma têm números
 * diferentes. Ver o campo `faltas` de Matricula no schema.
 */
export interface FaltasRepository {
  /** `null` quando o aluno não está matriculado nessa turma. */
  buscar(userId: string, turmaId: string): Promise<number | null>;
  /** `false` quando o aluno não está matriculado nessa turma. */
  definir(userId: string, turmaId: string, faltas: number): Promise<boolean>;
}
