import type {
  Curso as CursoRow,
  EstruturaCurricular as EstruturaRow,
  ComponenteCurricular as ComponenteRow,
} from '@prisma/client';
import type {
  ComponenteCurricularSalvo,
  CurriculoRepository,
  EstruturaCurricularSalva,
} from '../curriculo/curriculo.repository';
import type { EstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import { PrismaService } from './prisma.service';

function cursoParaDominio(row: CursoRow): CursoListaItem {
  return {
    idSigaa: row.idSigaa,
    nome: row.nome,
    sede: row.sede,
    nivel: row.nivel,
  };
}

function estruturaParaDominio(
  row: EstruturaRow & { componentes: ComponenteRow[] },
): EstruturaCurricularSalva {
  return {
    idSigaa: row.idSigaa,
    codigo: row.codigo,
    anoPeriodoImplementacao: row.anoPeriodoImplementacao,
    cargaHorariaTotal: row.cargaHorariaTotal,
    cargaHorariaObrigatoria: row.cargaHorariaObrigatoria,
    cargaHorariaOptativaMinima: row.cargaHorariaOptativaMinima,
    cargaHorariaComplementarMinima: row.cargaHorariaComplementarMinima,
    prazoMinimoSemestres: row.prazoMinimoSemestres,
    prazoMedioSemestres: row.prazoMedioSemestres,
    prazoMaximoSemestres: row.prazoMaximoSemestres,
    fetchedAt: row.fetchedAt,
    staleAfter: row.staleAfter,
    componentes: row.componentes.map((c): ComponenteCurricularSalvo => ({
      idSigaa: c.idSigaa,
      codigo: c.codigo,
      nome: c.nome,
      cargaHoraria: c.cargaHoraria,
      natureza: c.natureza as ComponenteCurricularSalvo['natureza'],
      periodo: c.periodo,
      unidadeResponsavel: c.unidadeResponsavel,
      preRequisito: c.preRequisito,
      coRequisito: c.coRequisito,
      equivalencias: c.equivalencias,
    })),
  };
}

export class PrismaCurriculoRepository implements CurriculoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarCursos(): Promise<CursoListaItem[]> {
    const rows = await this.prisma.curso.findMany();
    return rows.map(cursoParaDominio);
  }

  async buscarDiretorioAtualizadoEm(): Promise<Date | null> {
    const row = await this.prisma.curso.findFirst({
      select: { atualizadoEm: true },
    });
    return row ? row.atualizadoEm : null;
  }

  async salvarCursos(cursos: CursoListaItem[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.curso.deleteMany(),
      this.prisma.curso.createMany({
        data: cursos.map((c) => ({
          idSigaa: c.idSigaa,
          nome: c.nome,
          sede: c.sede,
          nivel: c.nivel,
        })),
      }),
    ]);
  }

  async buscarCursoPorId(idSigaa: string): Promise<CursoListaItem | null> {
    const row = await this.prisma.curso.findUnique({ where: { idSigaa } });
    return row ? cursoParaDominio(row) : null;
  }

  async buscarEstrutura(
    cursoId: string,
  ): Promise<EstruturaCurricularSalva | null> {
    const row = await this.prisma.estruturaCurricular.findFirst({
      where: { cursoId },
      include: {
        componentes: { orderBy: [{ periodo: 'asc' }, { codigo: 'asc' }] },
      },
    });
    return row ? estruturaParaDominio(row) : null;
  }

  async salvarEstrutura(
    cursoId: string,
    idSigaa: string,
    codigo: string,
    resumo: EstruturaResumo,
    componentesDetalhados: ComponenteCurricularSalvo[],
    staleAfter: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Componentes cascade off estruturaCurricular, so deleting any prior
      // structure for this curso clears its componentes too.
      await tx.estruturaCurricular.deleteMany({ where: { cursoId } });
      await tx.estruturaCurricular.create({
        data: {
          idSigaa,
          cursoId,
          codigo,
          anoPeriodoImplementacao: resumo.anoPeriodoImplementacao,
          cargaHorariaTotal: resumo.cargaHorariaTotal,
          cargaHorariaObrigatoria: resumo.cargaHorariaObrigatoria,
          cargaHorariaOptativaMinima: resumo.cargaHorariaOptativaMinima,
          cargaHorariaComplementarMinima: resumo.cargaHorariaComplementarMinima,
          prazoMinimoSemestres: resumo.prazoMinimoSemestres,
          prazoMedioSemestres: resumo.prazoMedioSemestres,
          prazoMaximoSemestres: resumo.prazoMaximoSemestres,
          staleAfter,
          componentes: {
            create: componentesDetalhados.map((c) => ({
              idSigaa: c.idSigaa,
              codigo: c.codigo,
              nome: c.nome,
              cargaHoraria: c.cargaHoraria,
              natureza: c.natureza,
              periodo: c.periodo,
              unidadeResponsavel: c.unidadeResponsavel,
              preRequisito: c.preRequisito,
              coRequisito: c.coRequisito,
              equivalencias: c.equivalencias,
            })),
          },
        },
      });
    });
  }
}
