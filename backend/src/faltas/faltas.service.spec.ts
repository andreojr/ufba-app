import type { FaltasRepository } from './faltas.repository';
import { FaltasService, MatriculaNaoEncontradaError } from './faltas.service';

function repositorioFalso(
  overrides: Partial<FaltasRepository> = {},
): jest.Mocked<FaltasRepository> {
  return {
    buscar: jest.fn().mockResolvedValue(0),
    definir: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as jest.Mocked<FaltasRepository>;
}

describe('FaltasService', () => {
  describe('buscar', () => {
    it('devolve o contador guardado na matrícula', async () => {
      const repo = repositorioFalso({ buscar: jest.fn().mockResolvedValue(3) });

      await expect(new FaltasService(repo).buscar('user-1', 'turma-1')).resolves.toBe(3);
      expect(repo.buscar).toHaveBeenCalledWith('user-1', 'turma-1');
    });

    // Sem isto, trocar o :turmaId na URL leria a matrícula de uma turma que
    // não é do aluno — mesma guarda do TurmaVirtualController.
    it('recusa quando o aluno não está matriculado na turma', async () => {
      const repo = repositorioFalso({ buscar: jest.fn().mockResolvedValue(null) });

      await expect(
        new FaltasService(repo).buscar('user-1', 'turma-de-outro'),
      ).rejects.toBeInstanceOf(MatriculaNaoEncontradaError);
    });
  });

  describe('definir', () => {
    it('grava o total absoluto e o devolve', async () => {
      const repo = repositorioFalso();

      await expect(new FaltasService(repo).definir('user-1', 'turma-1', 5)).resolves.toBe(5);
      expect(repo.definir).toHaveBeenCalledWith('user-1', 'turma-1', 5);
    });

    it('recusa quando o aluno não está matriculado na turma', async () => {
      const repo = repositorioFalso({ definir: jest.fn().mockResolvedValue(false) });

      await expect(
        new FaltasService(repo).definir('user-1', 'turma-de-outro', 5),
      ).rejects.toBeInstanceOf(MatriculaNaoEncontradaError);
    });

    // O contador é absoluto de propósito (ver DefinirFaltasDto): reenviar a
    // mesma requisição não pode somar duas vezes.
    it('é idempotente — salvar o mesmo total duas vezes mantém o valor', async () => {
      const repo = repositorioFalso();
      const service = new FaltasService(repo);

      await service.definir('user-1', 'turma-1', 4);
      await expect(service.definir('user-1', 'turma-1', 4)).resolves.toBe(4);
      expect(repo.definir).toHaveBeenNthCalledWith(2, 'user-1', 'turma-1', 4);
    });
  });
});
