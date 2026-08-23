import type { Prisma } from '@prisma/client';
import type {
  DadosPonto,
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from '../pontos-atencao/ponto-atencao.repository';
import { PrismaService } from './prisma.service';

const INCLUDE = {
  turma: { select: { codigo: true, nome: true } },
  responsavel: { select: { id: true, name: true } },
  votos: { select: { userId: true, valor: true } },
} as const;

type Registro = Prisma.PontoAtencaoGetPayload<{ include: typeof INCLUDE }>;

function paraLinha(registro: Registro, userId: string): PontoAtencaoLinha {
  const votos = registro.votos;
  return {
    id: registro.id,
    turmaId: registro.turmaId,
    turmaCodigo: registro.turma.codigo,
    turmaNome: registro.turma.nome,
    responsavelId: registro.responsavelId,
    responsavelNome: registro.responsavel?.name ?? null,
    // `tipo` e `valor` são String no schema, mais largos que o domínio: não
    // há enum no Postgres aqui, então a garantia mora na escrita.
    tipo: registro.tipo as 'PROVA' | 'TRABALHO',
    titulo: registro.titulo,
    data: registro.data,
    hora: registro.hora,
    observacao: registro.observacao,
    confirmacoes: votos.filter((v) => v.valor === 'CONFIRMA').length,
    contestacoes: votos.filter((v) => v.valor === 'CONTESTA').length,
    meuVoto:
      (votos.find((v) => v.userId === userId)?.valor as
        'CONFIRMA' | 'CONTESTA' | undefined) ?? null,
  };
}

export class PrismaPontoAtencaoRepository implements PontoAtencaoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async estaMatriculado(userId: string, turmaId: string): Promise<boolean> {
    const matricula = await this.prisma.matricula.findUnique({
      where: { userId_turmaId: { userId, turmaId } },
      select: { turmaId: true },
    });
    return matricula !== null;
  }

  async listar(
    userId: string,
    incluirVencidos: boolean,
  ): Promise<PontoAtencaoLinha[]> {
    // "Hoje" é o dia na Bahia, não em UTC: às 22h de Salvador já é o dia
    // seguinte em UTC, e o prazo de hoje sumiria da home duas horas cedo.
    // A coluna é DATE, gravada como meia-noite UTC — o alvo tem que casar.
    const hojeNaBahia = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bahia',
    }).format(new Date());
    const hoje = new Date(`${hojeNaBahia}T00:00:00Z`);

    const registros = await this.prisma.pontoAtencao.findMany({
      where: {
        turma: { matriculas: { some: { userId } } },
        ...(incluirVencidos ? {} : { data: { gte: hoje } }),
      },
      orderBy: { data: 'asc' },
      include: INCLUDE,
    });

    return registros.map((registro) => paraLinha(registro, userId));
  }

  async buscar(id: string, userId: string): Promise<PontoAtencaoLinha | null> {
    const registro = await this.prisma.pontoAtencao.findUnique({
      where: { id },
      include: INCLUDE,
    });
    return registro ? paraLinha(registro, userId) : null;
  }

  async criar(
    turmaId: string,
    responsavelId: string,
    dados: DadosPonto,
  ): Promise<string> {
    const { id } = await this.prisma.pontoAtencao.create({
      data: { turmaId, responsavelId, ...dados },
      select: { id: true },
    });
    return id;
  }

  async atualizar(
    id: string,
    dados: DadosPonto,
    responsavelId: string,
    zerarVotos: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.pontoAtencao.update({
        where: { id },
        data: { ...dados, responsavelId },
      });
      if (zerarVotos) {
        await tx.pontoAtencaoVoto.deleteMany({ where: { pontoId: id } });
      }
    });
  }

  async apagar(id: string): Promise<void> {
    await this.prisma.pontoAtencao.delete({ where: { id } });
  }

  async votar(
    pontoId: string,
    userId: string,
    valor: 'CONFIRMA' | 'CONTESTA',
  ): Promise<void> {
    await this.prisma.pontoAtencaoVoto.upsert({
      where: { pontoId_userId: { pontoId, userId } },
      create: { pontoId, userId, valor },
      update: { valor },
    });
  }

  async removerVoto(pontoId: string, userId: string): Promise<void> {
    await this.prisma.pontoAtencaoVoto.deleteMany({
      where: { pontoId, userId },
    });
  }
}
