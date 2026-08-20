import type {
  HistoricoRepository,
  ItemPlano,
  TrajetoriaSalva,
} from '../sigaa-engine/historico.repository';
import type {
  Historico,
  NaturezaComponente,
  SituacaoComponente,
} from '../sigaa-engine/parsers/historico';
import { PrismaService } from './prisma.service';

export class PrismaHistoricoRepository implements HistoricoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async salvar(userId: string, historico: Historico): Promise<void> {
    const { cargaHoraria: ch } = historico;

    await this.prisma.$transaction(async (tx) => {
      // Componentes and pendentes cascade off historico, so one delete clears
      // the whole snapshot.
      await tx.historico.deleteMany({ where: { userId } });
      await tx.historico.create({
        data: {
          userId,
          emitidoEm: new Date(historico.emitidoEm),
          curriculo: historico.curriculo,
          nomeCurso: historico.nomeCurso,
          periodoLetivoAtual: historico.periodoLetivoAtual,
          prazoPadrao: historico.prazoConclusaoPadrao,
          prazoMaximo: historico.prazoConclusaoMaximo,
          cr: historico.indices.cr,
          iap: historico.indices.iap,
          chObrigatoriaExigida: ch.obrigatorias.exigida,
          chObrigatoriaIntegralizada: ch.obrigatorias.integralizada,
          chObrigatoriaPendente: ch.obrigatorias.pendente,
          chOptativaExigida: ch.optativas.exigida,
          chOptativaIntegralizada: ch.optativas.integralizada,
          chOptativaPendente: ch.optativas.pendente,
          chComplementarExigida: ch.complementares.exigida,
          chComplementarIntegralizada: ch.complementares.integralizada,
          chComplementarPendente: ch.complementares.pendente,
          chTotalExigida: ch.total.exigida,
          chTotalIntegralizada: ch.total.integralizada,
          chTotalPendente: ch.total.pendente,
          equivalencias: historico.equivalencias,
          observacoes: historico.observacoes,
          componentes: { create: historico.cursados },
          pendentes: { create: historico.pendentesObrigatorios },
        },
      });
    });
  }

  async buscar(userId: string): Promise<TrajetoriaSalva | null> {
    const registro = await this.prisma.historico.findUnique({
      where: { userId },
      include: {
        componentes: { orderBy: [{ semestre: 'asc' }, { codigo: 'asc' }] },
        // codigo alone is not unique: the ENADE pendente rows share a código
        // under two different nomes, so nome breaks the tie deterministically.
        pendentes: { orderBy: [{ codigo: 'asc' }, { nome: 'asc' }] },
      },
    });

    if (!registro) {
      return null;
    }

    const plano = await this.prisma.planoItem.findMany({
      where: { userId },
      orderBy: { codigo: 'asc' },
    });

    return {
      fetchedAt: registro.fetchedAt,
      plano: plano.map(
        (item): ItemPlano => ({
          codigo: item.codigo,
          nome: item.nome,
          cargaHoraria: item.cargaHoraria,
          semestre: item.semestre,
        }),
      ),
      historico: {
        emitidoEm: registro.emitidoEm.toISOString().slice(0, 10),
        curriculo: registro.curriculo,
        nomeCurso: registro.nomeCurso,
        periodoLetivoAtual: registro.periodoLetivoAtual,
        prazoConclusaoPadrao: registro.prazoPadrao,
        prazoConclusaoMaximo: registro.prazoMaximo,
        indices: {
          cr: registro.cr === null ? null : Number(registro.cr),
          iap: registro.iap === null ? null : Number(registro.iap),
        },
        cursados: registro.componentes.map((c) => ({
          semestre: c.semestre,
          natureza: c.natureza as NaturezaComponente | null,
          codigo: c.codigo,
          nome: c.nome,
          cargaHoraria: c.cargaHoraria,
          nota: c.nota === null ? null : Number(c.nota),
          situacao: c.situacao as SituacaoComponente,
          docente: c.docente,
        })),
        pendentesObrigatorios: registro.pendentes.map((p) => ({
          codigo: p.codigo,
          nome: p.nome,
          cargaHoraria: p.cargaHoraria,
          matriculado: p.matriculado,
        })),
        cargaHoraria: {
          obrigatorias: {
            exigida: registro.chObrigatoriaExigida,
            integralizada: registro.chObrigatoriaIntegralizada,
            pendente: registro.chObrigatoriaPendente,
          },
          optativas: {
            exigida: registro.chOptativaExigida,
            integralizada: registro.chOptativaIntegralizada,
            pendente: registro.chOptativaPendente,
          },
          complementares: {
            exigida: registro.chComplementarExigida,
            integralizada: registro.chComplementarIntegralizada,
            pendente: registro.chComplementarPendente,
          },
          total: {
            exigida: registro.chTotalExigida,
            integralizada: registro.chTotalIntegralizada,
            pendente: registro.chTotalPendente,
          },
        },
        equivalencias: registro.equivalencias,
        observacoes: registro.observacoes,
      },
    };
  }

  async reconciliarPlano(userId: string, codigosConcluidos: string[]): Promise<void> {
    // Positive derivation: `in`, not `notIn` — see the interface doc for why
    // "not currently pending" is the wrong predicate. `in: []` deletes
    // nothing, so a student with no concluded components this sync is safe
    // by construction.
    await this.prisma.planoItem.deleteMany({
      where: { userId, codigo: { in: codigosConcluidos } },
    });
  }
}
