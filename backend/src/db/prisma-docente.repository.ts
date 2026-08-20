import type {
  Docente as DocenteRow,
  DocenteLookup as LookupRow,
} from '@prisma/client';
import type {
  DocenteLookupSalvo,
  DocenteRepository,
  DocenteSalvo,
} from '../docentes/docente.repository';
import type { DocenteDisciplina } from '../sigaa-engine/parsers/docente-disciplinas';
import { PrismaService } from './prisma.service';

function paraDominio(row: DocenteRow): DocenteSalvo {
  return {
    siape: row.siape,
    nome: row.nome,
    departamento: row.departamento,
    unidade: row.unidade,
    descricaoPessoal: row.descricaoPessoal,
    formacao: row.formacao,
    areasInteresse: row.areasInteresse,
    lattesUrl: row.lattesUrl,
    enderecoProfissional: row.enderecoProfissional,
    sala: row.sala,
    telefone: row.telefone,
    email: row.email,
    disciplinas: (row.disciplinas ?? []) as unknown as DocenteDisciplina[],
    tccsOrientados: (row.tccsOrientados ?? []) as unknown as {
      titulo: string;
      ano: number;
    }[],
    orientacoes: {
      mestradoAndamento: row.orientacoesMestradoAndamento,
      mestradoConcluidas: row.orientacoesMestradoConcluidas,
      doutoradoAndamento: row.orientacoesDoutoradoAndamento,
      doutoradoConcluidas: row.orientacoesDoutoradoConcluidas,
    },
    fetchedAt: row.fetchedAt,
    staleAfter: row.staleAfter,
  };
}

function lookupParaDominio(row: LookupRow): DocenteLookupSalvo {
  return {
    nomeNormalizado: row.nomeNormalizado,
    nomeOriginal: row.nomeOriginal,
    siape: row.siape,
    staleAfter: row.staleAfter,
  };
}

export class PrismaDocenteRepository implements DocenteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarLookups(
    nomesNormalizados: string[],
  ): Promise<DocenteLookupSalvo[]> {
    if (nomesNormalizados.length === 0) return [];
    const rows = await this.prisma.docenteLookup.findMany({
      where: { nomeNormalizado: { in: nomesNormalizados } },
    });
    return rows.map(lookupParaDominio);
  }

  async buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]> {
    if (siapes.length === 0) return [];
    const rows = await this.prisma.docente.findMany({
      where: { siape: { in: siapes } },
    });
    return rows.map(paraDominio);
  }

  async salvarDocente(docente: DocenteSalvo): Promise<void> {
    const dados = {
      nome: docente.nome,
      departamento: docente.departamento,
      unidade: docente.unidade,
      descricaoPessoal: docente.descricaoPessoal,
      formacao: docente.formacao,
      areasInteresse: docente.areasInteresse,
      lattesUrl: docente.lattesUrl,
      enderecoProfissional: docente.enderecoProfissional,
      sala: docente.sala,
      telefone: docente.telefone,
      email: docente.email,
      disciplinas: docente.disciplinas as unknown as object,
      tccsOrientados: docente.tccsOrientados as unknown as object,
      orientacoesMestradoAndamento: docente.orientacoes.mestradoAndamento,
      orientacoesMestradoConcluidas: docente.orientacoes.mestradoConcluidas,
      orientacoesDoutoradoAndamento: docente.orientacoes.doutoradoAndamento,
      orientacoesDoutoradoConcluidas: docente.orientacoes.doutoradoConcluidas,
      fetchedAt: docente.fetchedAt,
      staleAfter: docente.staleAfter,
    };
    await this.prisma.docente.upsert({
      where: { siape: docente.siape },
      create: { siape: docente.siape, ...dados },
      update: dados,
    });
  }

  async salvarLookup(lookup: DocenteLookupSalvo): Promise<void> {
    const dados = {
      nomeOriginal: lookup.nomeOriginal,
      siape: lookup.siape,
      resolvedAt: new Date(),
      staleAfter: lookup.staleAfter,
    };
    await this.prisma.docenteLookup.upsert({
      where: { nomeNormalizado: lookup.nomeNormalizado },
      create: { nomeNormalizado: lookup.nomeNormalizado, ...dados },
      update: dados,
    });
  }
}
