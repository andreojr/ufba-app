import type { DocenteDisciplina } from '../sigaa-engine/parsers/docente-disciplinas';
import type { DocenteProducao } from '../sigaa-engine/parsers/docente-producao';

export interface DocenteSalvo {
  siape: string;
  nome: string;
  departamento: string | null;
  unidade: string | null;
  descricaoPessoal: string | null;
  formacao: string[];
  areasInteresse: string[];
  lattesUrl: string | null;
  enderecoProfissional: string | null;
  sala: string | null;
  telefone: string | null;
  email: string | null;
  disciplinas: DocenteDisciplina[];
  tccsOrientados: { titulo: string; ano: number }[];
  orientacoes: DocenteProducao['orientacoes'];
  fetchedAt: Date;
  staleAfter: Date;
}

export interface DocenteLookupSalvo {
  nomeNormalizado: string;
  nomeOriginal: string;
  /** Null is a recorded MISS: this name has no public record. */
  siape: string | null;
  staleAfter: Date;
}

export interface DocenteRepository {
  buscarLookups(nomesNormalizados: string[]): Promise<DocenteLookupSalvo[]>;
  buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]>;
  salvarDocente(docente: DocenteSalvo): Promise<void>;
  salvarLookup(lookup: DocenteLookupSalvo): Promise<void>;
}
