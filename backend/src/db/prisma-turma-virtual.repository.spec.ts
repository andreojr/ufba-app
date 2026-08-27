import { PrismaTurmaVirtualRepository } from './prisma-turma-virtual.repository';
import { PrismaService } from './prisma.service';

describe('PrismaTurmaVirtualRepository', () => {
  // O `nome` vem junto porque é por ele que o serviço reencontra o token
  // atual na home do portal — o guardado é só fallback.
  it('returns the stored frontEndIdTurma and the nome for a turma', async () => {
    const prisma = {
      turma: {
        findUnique: jest.fn().mockResolvedValue({
          frontEndIdTurma: 'token-123',
          nome: 'SISTEMAS OPERACIONAIS',
        }),
      },
    } as unknown as PrismaService;
    const repository = new PrismaTurmaVirtualRepository(prisma);

    const registro = await repository.buscarToken('turma-uuid');

    expect(registro).toEqual({
      frontEndIdTurma: 'token-123',
      nome: 'SISTEMAS OPERACIONAIS',
    });
    expect(prisma.turma.findUnique).toHaveBeenCalledWith({
      where: { id: 'turma-uuid' },
      select: { frontEndIdTurma: true, nome: true },
    });
  });

  it('returns null when the turma does not exist', async () => {
    const prisma = {
      turma: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const repository = new PrismaTurmaVirtualRepository(prisma);

    expect(await repository.buscarToken('id-inexistente')).toBeNull();
  });
});
