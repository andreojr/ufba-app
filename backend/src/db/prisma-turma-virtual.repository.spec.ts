import { PrismaTurmaVirtualRepository } from './prisma-turma-virtual.repository';
import { PrismaService } from './prisma.service';

describe('PrismaTurmaVirtualRepository', () => {
  it('returns the stored frontEndIdTurma for a turma', async () => {
    const prisma = {
      turma: { findUnique: jest.fn().mockResolvedValue({ frontEndIdTurma: 'token-123' }) },
    } as unknown as PrismaService;
    const repository = new PrismaTurmaVirtualRepository(prisma);

    const registro = await repository.buscarToken('turma-uuid');

    expect(registro).toEqual({ frontEndIdTurma: 'token-123' });
    expect(prisma.turma.findUnique).toHaveBeenCalledWith({
      where: { id: 'turma-uuid' },
      select: { frontEndIdTurma: true },
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
