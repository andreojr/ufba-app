import type { FaltasRepository } from '../faltas/faltas.repository';
import { PrismaService } from './prisma.service';

export class PrismaFaltasRepository implements FaltasRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(userId: string, turmaId: string): Promise<number | null> {
    const matricula = await this.prisma.matricula.findUnique({
      where: { userId_turmaId: { userId, turmaId } },
      select: { faltas: true },
    });
    return matricula?.faltas ?? null;
  }

  async definir(
    userId: string,
    turmaId: string,
    faltas: number,
  ): Promise<boolean> {
    // updateMany em vez de update: `update` estoura P2025 quando a matrícula
    // não existe, e "não está matriculado" é uma resposta esperada (403), não
    // uma exceção do Prisma pra traduzir depois.
    const { count } = await this.prisma.matricula.updateMany({
      where: { userId, turmaId },
      data: { faltas },
    });
    return count > 0;
  }
}
