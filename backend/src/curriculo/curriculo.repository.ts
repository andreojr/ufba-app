import type {
  ComponenteResumoMatriz,
  EstruturaResumo,
} from '../sigaa-engine/parsers/estrutura-resumo';
import type { ComponenteResumoDetalhe } from '../sigaa-engine/parsers/componente-resumo';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';

// `jsfParams` is a parse-time-only field (the exact POST body needed to fetch
// this component's detail page) — it is never persisted, so the saved/cached
// shape omits it.
export interface ComponenteCurricularSalvo
  extends Omit<ComponenteResumoMatriz, 'jsfParams'>,
    ComponenteResumoDetalhe {}

export interface EstruturaCurricularSalva {
  idSigaa: string;
  codigo: string;
  anoPeriodoImplementacao: string;
  cargaHorariaTotal: number;
  cargaHorariaObrigatoria: number;
  cargaHorariaOptativaMinima: number;
  cargaHorariaComplementarMinima: number;
  prazoMinimoSemestres: number;
  prazoMedioSemestres: number;
  prazoMaximoSemestres: number;
  fetchedAt: Date;
  /** When this cached row should be treated as stale and re-resolved. */
  staleAfter: Date;
  componentes: ComponenteCurricularSalvo[];
}

export interface CurriculoRepository {
  /** Empty array means the directory has never been populated. */
  buscarCursos(): Promise<CursoListaItem[]>;
  /**
   * When the directory was last wholesale-refreshed, or null if it has never
   * been populated. Every row from a given `salvarCursos` write shares this
   * same timestamp.
   */
  buscarDiretorioAtualizadoEm(): Promise<Date | null>;
  /** Wholesale replace — see the module's Global Constraints on why. */
  salvarCursos(cursos: CursoListaItem[]): Promise<void>;
  buscarCursoPorId(idSigaa: string): Promise<CursoListaItem | null>;
  /** Null means this course's curriculum has never been resolved, or resolved and since evicted. */
  buscarEstrutura(cursoId: string): Promise<EstruturaCurricularSalva | null>;
  /** Wholesale replace of this course's structure + all its componentes. */
  salvarEstrutura(
    cursoId: string,
    idSigaa: string,
    codigo: string,
    resumo: EstruturaResumo,
    componentesDetalhados: ComponenteCurricularSalvo[],
    staleAfter: Date,
  ): Promise<void>;
}
