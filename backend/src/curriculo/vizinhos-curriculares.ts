import { extrairCodigosCitados } from './arvore-dependencias';
import { avaliarPreRequisito } from './avaliador-prerequisito';

export type SituacaoVizinho = 'cursada' | 'emCurso' | 'liberada' | 'bloqueada';

export interface ComponenteParaVizinhos {
  codigo: string;
  nome: string;
  preRequisito: string | null;
}

export interface HistoricoParaVizinhos {
  aprovados: ReadonlySet<string>;
  matriculados: ReadonlySet<string>;
}

export interface VizinhoCurricular {
  codigo: string;
  nome: string;
  situacao: SituacaoVizinho;
}

export interface VizinhosCurriculares {
  atual: VizinhoCurricular;
  preRequisitos: VizinhoCurricular[];
  desbloqueia: VizinhoCurricular[];
}

function calcularSituacao(
  componente: ComponenteParaVizinhos,
  historico: HistoricoParaVizinhos,
): SituacaoVizinho {
  if (historico.aprovados.has(componente.codigo)) {
    return 'cursada';
  }
  if (historico.matriculados.has(componente.codigo)) {
    return 'emCurso';
  }
  return avaliarPreRequisito(componente.preRequisito, historico.aprovados)
    ? 'liberada'
    : 'bloqueada';
}

function paraVizinho(
  componente: ComponenteParaVizinhos,
  historico: HistoricoParaVizinhos,
): VizinhoCurricular {
  return {
    codigo: componente.codigo,
    nome: componente.nome,
    situacao: calcularSituacao(componente, historico),
  };
}

/**
 * Monta a matéria atual, seus pré-requisitos DIRETOS (um nível, não
 * transitivo) e o que ela desbloqueia DIRETAMENTE — cada um com a situação
 * do aluno pra aquela matéria. `null` quando `codigoRaiz` não existe em
 * `componentes` (a estrutura curricular ativa) — quem chama decide como
 * comunicar isso (404, tipicamente).
 */
export function montarVizinhos(
  componentes: ComponenteParaVizinhos[],
  codigoRaiz: string,
  historico: HistoricoParaVizinhos,
): VizinhosCurriculares | null {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  const raiz = porCodigo.get(codigoRaiz);
  if (!raiz) {
    return null;
  }

  const codigosPreRequisito = extrairCodigosCitados(raiz.preRequisito).filter((codigo) =>
    porCodigo.has(codigo),
  );
  const preRequisitos = codigosPreRequisito.map((codigo) =>
    paraVizinho(porCodigo.get(codigo)!, historico),
  );

  const desbloqueia = componentes
    .filter((c) => extrairCodigosCitados(c.preRequisito).includes(codigoRaiz))
    .map((c) => paraVizinho(c, historico));

  return {
    atual: paraVizinho(raiz, historico),
    preRequisitos,
    desbloqueia,
  };
}
