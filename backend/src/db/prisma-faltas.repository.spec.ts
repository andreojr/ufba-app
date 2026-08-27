import { PrismaFaltasRepository } from './prisma-faltas.repository';
import type { PrismaService } from './prisma.service';

describe('PrismaFaltasRepository', () => {
  describe('buscar', () => {
    it('lê o contador da matrícula do próprio aluno', async () => {
      const findUnique = jest.fn(async () => ({ faltas: 7 }));
      const prisma = { matricula: { findUnique } } as unknown as PrismaService;

      await expect(
        new PrismaFaltasRepository(prisma).buscar('user-1', 'turma-1'),
      ).resolves.toBe(7);
      expect(findUnique).toHaveBeenCalledWith({
        where: { userId_turmaId: { userId: 'user-1', turmaId: 'turma-1' } },
        select: { faltas: true },
      });
    });

    it('devolve null quando não existe matrícula', async () => {
      const prisma = {
        matricula: { findUnique: jest.fn(async () => null) },
      } as unknown as PrismaService;

      await expect(
        new PrismaFaltasRepository(prisma).buscar('user-1', 'turma-1'),
      ).resolves.toBeNull();
    });
  });

  describe('definir', () => {
    it('grava e confirma quando a matrícula existe', async () => {
      const updateMany = jest.fn(async () => ({ count: 1 }));
      const prisma = { matricula: { updateMany } } as unknown as PrismaService;

      await expect(
        new PrismaFaltasRepository(prisma).definir('user-1', 'turma-1', 3),
      ).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', turmaId: 'turma-1' },
        data: { faltas: 3 },
      });
    });

    // updateMany em vez de update justamente para isto: `update` estouraria
    // P2025 e "não matriculado" viraria 500 em vez de 403.
    it('devolve false, sem lançar, quando nenhuma matrícula casa', async () => {
      const prisma = {
        matricula: { updateMany: jest.fn(async () => ({ count: 0 })) },
      } as unknown as PrismaService;

      await expect(
        new PrismaFaltasRepository(prisma).definir('user-1', 'turma-de-outro', 3),
      ).resolves.toBe(false);
    });
  });
});
