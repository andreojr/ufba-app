/** O que a turma persistida tem de útil pra entrar na Turma Virtual. */
export interface TurmaVirtualTokenSalvo {
  /** Token de uma sessão anterior — só fallback, ver TurmaVirtualService.entrarNaTurma. */
  frontEndIdTurma: string | null;
  /**
   * Chave de casamento com a home do portal recém-lida (ex.
   * `PROJETO DE CIRCUITOS INTEGRADOS DIGITAIS`). Não é o código: o link real
   * da home do SIGAA não carrega o código do componente, só o nome
   * (confirmado contra sigaa.ufba.br).
   */
  nome: string;
}

/** Just enough to look up the persisted Turma Virtual token by turma id. */
export interface TurmaVirtualRepository {
  buscarToken(turmaId: string): Promise<TurmaVirtualTokenSalvo | null>;
}
