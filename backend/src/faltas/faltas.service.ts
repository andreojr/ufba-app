import type { FaltasRepository } from './faltas.repository';

/**
 * O aluno não está matriculado na turma que pediu. Mesmo raciocínio do
 * `exigirMatricula` do TurmaVirtualController: sem essa guarda, trocar o
 * :turmaId da URL leria (ou escreveria) a matrícula de outra turma.
 */
export class MatriculaNaoEncontradaError extends Error {
  constructor() {
    super('Você não está matriculado nesta turma.');
    this.name = 'MatriculaNaoEncontradaError';
  }
}

export class FaltasService {
  constructor(private readonly repository: FaltasRepository) {}

  async buscar(userId: string, turmaId: string): Promise<number> {
    const faltas = await this.repository.buscar(userId, turmaId);
    if (faltas === null) {
      throw new MatriculaNaoEncontradaError();
    }
    return faltas;
  }

  async definir(
    userId: string,
    turmaId: string,
    faltas: number,
  ): Promise<number> {
    const atualizou = await this.repository.definir(userId, turmaId, faltas);
    if (!atualizou) {
      throw new MatriculaNaoEncontradaError();
    }
    return faltas;
  }
}
