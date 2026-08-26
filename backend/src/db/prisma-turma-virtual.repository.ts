import type { TurmaVirtualRepository } from '../sigaa-engine/turma-virtual.repository';
import { PrismaService } from './prisma.service';

export class PrismaTurmaVirtualRepository implements TurmaVirtualRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarToken(turmaId: string): Promise<{ frontEndIdTurma: string | null } | null> {
    const turma = await this.prisma.turma.findUnique({
      where: { id: turmaId },
      select: { frontEndIdTurma: true },
    });
    return turma ? { frontEndIdTurma: turma.frontEndIdTurma } : null;
  }
}
