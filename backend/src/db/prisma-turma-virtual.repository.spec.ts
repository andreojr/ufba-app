import { PrismaTurmaVirtualRepository } from './prisma-turma-virtual.repository';
import { PrismaService } from './prisma.service';

describe('PrismaTurmaVirtualRepository', () => {
  // O `codigo` vem junto porque é por ele que o serviço reencontra o token
  // atual na home do portal — o guardado é só fallback.
  it('returns the stored frontEndIdTurma and the codigo for a turma', async () => {
    const prisma = {
      turma: {
        findUnique: jest.fn().mockResolvedValue({
          frontEndIdTurma: 'token-123',
          codigo: 'MATA58',
        }),
      },
    } as unknown as PrismaService;
    const repository = new PrismaTurmaVirtualRepository(prisma);

    const registro = await repository.buscarToken('turma-uuid');

    expect(registro).toEqual({
      frontEndIdTurma: 'token-123',
      codigo: 'MATA58',
    });
    expect(prisma.turma.findUnique).toHaveBeenCalledWith({
      where: { id: 'turma-uuid' },
      select: { frontEndIdTurma: true, codigo: true },
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
