import type {
  TurmaVirtualRepository,
  TurmaVirtualTokenSalvo,
} from '../sigaa-engine/turma-virtual.repository';
import { PrismaService } from './prisma.service';

export class PrismaTurmaVirtualRepository implements TurmaVirtualRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarToken(turmaId: string): Promise<TurmaVirtualTokenSalvo | null> {
    const turma = await this.prisma.turma.findUnique({
      where: { id: turmaId },
      // `nome` vem junto porque é por ele que o serviço reencontra o token
      // atual na home do portal — o guardado é só fallback.
      select: { frontEndIdTurma: true, nome: true },
    });
    return turma
      ? { frontEndIdTurma: turma.frontEndIdTurma, nome: turma.nome }
      : null;
  }
}
