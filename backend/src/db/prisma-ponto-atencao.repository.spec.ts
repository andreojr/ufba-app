import { PrismaPontoAtencaoRepository } from './prisma-ponto-atencao.repository';
import type { PrismaService } from './prisma.service';

describe('PrismaPontoAtencaoRepository', () => {
  it('conta os votos e destaca o voto do próprio usuário', async () => {
    const prisma = {
      pontoAtencao: {
        findMany: jest.fn(async () => [
          {
            id: 'ponto-1',
            turmaId: 'turma-1',
            tipo: 'PROVA',
            titulo: 'Avaliação I',
            data: new Date('2026-09-22T00:00:00Z'),
            hora: '16:40',
            observacao: null,
            responsavelId: 'user-2',
            responsavel: { id: 'user-2', name: 'Bruno' },
            turma: { codigo: 'ENGG64', nome: 'VISÃO COMPUTACIONAL' },
            votos: [
              { userId: 'user-1', valor: 'CONTESTA' },
              { userId: 'user-3', valor: 'CONFIRMA' },
              { userId: 'user-4', valor: 'CONFIRMA' },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const [linha] = await new PrismaPontoAtencaoRepository(prisma).listar(
      'user-1',
      false,
    );

    expect(linha.confirmacoes).toBe(2);
    expect(linha.contestacoes).toBe(1);
    expect(linha.meuVoto).toBe('CONTESTA');
    expect(linha.responsavelNome).toBe('Bruno');
    expect(linha.turmaCodigo).toBe('ENGG64');
  });

  it('só apaga os votos quando mandado zerar', async () => {
    const tx = {
      pontoAtencao: { update: jest.fn(async () => undefined) },
      pontoAtencaoVoto: { deleteMany: jest.fn(async () => undefined) },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) =>
        fn(tx),
      ),
    } as unknown as PrismaService;

    const repo = new PrismaPontoAtencaoRepository(prisma);
    const dados = {
      tipo: 'PROVA' as const,
      titulo: 'Avaliação I',
      data: new Date('2026-09-22T00:00:00Z'),
      hora: null,
      observacao: null,
    };

    await repo.atualizar('ponto-1', dados, 'user-1', false);
    expect(tx.pontoAtencaoVoto.deleteMany).not.toHaveBeenCalled();

    await repo.atualizar('ponto-1', dados, 'user-1', true);
    expect(tx.pontoAtencaoVoto.deleteMany).toHaveBeenCalledWith({
      where: { pontoId: 'ponto-1' },
    });
  });
});
