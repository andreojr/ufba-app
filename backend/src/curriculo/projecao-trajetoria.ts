import type { ItemPlano } from '../sigaa-engine/historico.repository';
import {
  SITUACOES_INTEGRALIZADAS,
  type Historico,
} from '../sigaa-engine/parsers/historico';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { montarFila } from './fila-de-pendentes';
import type { MarcosResponse } from './marcos-semestralizacao';
import { alocar, type SemestreProjetado } from './projetor';
import { compararSemestres, distanciaEmSemestres, proximoSemestre } from './semestre';
import { tetoDeCarga } from './teto-de-carga';

export interface ProjecaoResponse {
  semestres: SemestreProjetado[];
  teto: number;
  atrasadas: number;
  /** O último semestre da projeção — onde a linha de chegada aterrissa. */
  conclusaoProjetada: string;
  /** Distância até `prazoConclusaoPadrao`; zero quando termina no prazo ou antes. */
  semestresAlemDoPrevisto: number;
  alemDoPrazoMaximo: boolean;
}

/**
 * As horas de optativa e complementar que faltam, derramadas no espaço que
 * sobra do teto em cada semestre — optativas primeiro.
 *
 * Não são componentes e não têm id: o bloco que a tela desenha é resíduo de
 * renderização, não entidade. É isso que deixa a futura seleção de optativas
 * barata — ela vai operar sobre a exigência inteira, não sobre um bloco.
 */
export function derramarHorasGenericas(
  semestres: SemestreProjetado[],
  horasOptativas: number,
  horasComplementares: number,
  teto: number,
  primeiroSemestre: string,
): SemestreProjetado[] {
  if (horasOptativas <= 0 && horasComplementares <= 0) {
    return semestres;
  }

  const resultado = semestres.map((s) => ({ ...s }));
  let optativas = horasOptativas;
  let complementares = horasComplementares;
  let indice = 0;

  while (optativas > 0 || complementares > 0) {
    if (indice === resultado.length) {
      const semestre =
        indice === 0
          ? primeiroSemestre
          : proximoSemestre(resultado[indice - 1].semestre);
      resultado.push({ semestre, componentes: [], horasOptativas: 0, horasComplementares: 0 });
    }
    const atual = resultado[indice];
    const ocupado = atual.componentes.reduce((soma, c) => soma + c.cargaHoraria, 0);
    let folga = Math.max(0, teto - ocupado);

    const deOptativa = Math.min(folga, optativas);
    atual.horasOptativas += deOptativa;
    optativas -= deOptativa;
    folga -= deOptativa;

    const deComplementar = Math.min(folga, complementares);
    atual.horasComplementares += deComplementar;
    complementares -= deComplementar;

    // Um semestre já lotado de obrigatórias tem folga zero: sem esta guarda o
    // laço giraria nele para sempre.
    if (deOptativa === 0 && deComplementar === 0 && indice === resultado.length - 1) {
      resultado.push({
        semestre: proximoSemestre(atual.semestre),
        componentes: [],
        horasOptativas: 0,
        horasComplementares: 0,
      });
    }
    indice += 1;
  }

  return resultado;
}

/** O semestre em que a projeção começa: o seguinte ao último do histórico. */
function primeiroSemestreFuturo(historico: Historico): string {
  const semestres = historico.cursados.map((c) => c.semestre).sort(compararSemestres);
  const ultimo = semestres[semestres.length - 1];
  return ultimo ? proximoSemestre(ultimo) : historico.prazoConclusaoPadrao;
}

/**
 * Os códigos que satisfazem um pré-requisito: o que o aluno concluiu, mais —
 * para cada concluído que substitui um código antigo — o código substituído.
 * Quem cursou VELHA2 satisfaz um pré-requisito escrito como NOVA2.
 */
function codigosConcluidos(historico: Historico, marcos: MarcosResponse): Set<string> {
  const substitutoDe = new Map(marcos.equivalencias.map((e) => [e.codigo, e.equivalenteDe]));
  const concluidos = new Set<string>();
  for (const componente of historico.cursados) {
    if (!SITUACOES_INTEGRALIZADAS.includes(componente.situacao)) {
      continue;
    }
    concluidos.add(componente.codigo);
    const substituto = substitutoDe.get(componente.codigo);
    if (substituto) {
      concluidos.add(substituto);
    }
  }
  return concluidos;
}

/**
 * A projeção inteira, pronta para o controller serializar.
 *
 * O prazo máximo do histórico não vira corte: parar de alocar ali deixaria
 * matérias sem semestre nenhum e esconderia justamente o aluno que mais
 * precisa saber. A projeção segue até a fila esvaziar e devolve
 * `alemDoPrazoMaximo` — aviso, não bloqueio, porque o prazo tem prorrogação
 * por processo e o app não sabe se ela já aconteceu.
 */
export function montarProjecao(
  estrutura: EstruturaCurricularSalva,
  historico: Historico,
  marcos: MarcosResponse,
  overrides: ItemPlano[],
): ProjecaoResponse {
  const teto = tetoDeCarga(estrutura.componentes, historico.cursados);
  const fila = montarFila(
    historico.pendentesObrigatorios,
    estrutura.componentes,
    marcos.equivalencias,
    historico.periodoLetivoAtual,
  );
  const fixos = new Map(
    overrides.flatMap((item) => (item.semestre ? [[item.codigo, item.semestre] as const] : [])),
  );
  const primeiro = primeiroSemestreFuturo(historico);

  const alocados = alocar(fila, fixos, codigosConcluidos(historico, marcos), primeiro, teto);
  const semestres = derramarHorasGenericas(
    alocados,
    historico.cargaHoraria.optativas.pendente,
    historico.cargaHoraria.complementares.pendente,
    teto,
    primeiro,
  );

  const conclusaoProjetada = semestres[semestres.length - 1]?.semestre ?? primeiro;

  return {
    semestres,
    teto,
    atrasadas: fila.filter((item) => item.atrasada).length,
    conclusaoProjetada,
    semestresAlemDoPrevisto: Math.max(
      0,
      distanciaEmSemestres(historico.prazoConclusaoPadrao, conclusaoProjetada),
    ),
    alemDoPrazoMaximo:
      compararSemestres(conclusaoProjetada, historico.prazoConclusaoMaximo) > 0,
  };
}
