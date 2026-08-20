import type {
  ComponenteResumoMatriz,
  EstruturaResumo,
} from '../sigaa-engine/parsers/estrutura-resumo';
import type { ComponenteResumoDetalhe } from '../sigaa-engine/parsers/componente-resumo';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';

export interface ComponenteCurricularSalvo
  extends ComponenteResumoMatriz, ComponenteResumoDetalhe {}

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
  componentes: ComponenteCurricularSalvo[];
}

export interface CurriculoRepository {
  /** Empty array means the directory has never been populated. */
  buscarCursos(): Promise<CursoListaItem[]>;
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
