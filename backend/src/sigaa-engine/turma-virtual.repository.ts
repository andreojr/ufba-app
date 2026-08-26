/** O que a turma persistida tem de útil pra entrar na Turma Virtual. */
export interface TurmaVirtualTokenSalvo {
  /** Token de uma sessão anterior — só fallback, ver TurmaVirtualService.entrarNaTurma. */
  frontEndIdTurma: string | null;
  /** Chave de casamento com a home do portal recém-lida (ex. `MATA58`). */
  codigo: string | null;
}

/** Just enough to look up the persisted Turma Virtual token by turma id. */
export interface TurmaVirtualRepository {
  buscarToken(turmaId: string): Promise<TurmaVirtualTokenSalvo | null>;
}
