import type { ItemPlano } from '../sigaa-engine/historico.repository';
import {
  SITUACOES_INTEGRALIZADAS,
  type Historico,
} from '../sigaa-engine/parsers/historico';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { montarFila } from './fila-de-pendentes';
import type { MarcosResponse } from './marcos-semestralizacao';
import { alocar, compactarSemestres, type SemestreProjetado } from './projetor';
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

    // Teto degenerado (ver `tetoDeCarga`): zero não é um limite real, é
    // ausência de dado. Num semestre vazio (nenhuma obrigatória alocada) ele
    // deixaria a folga sempre zero e o laço giraria para sempre — aqui não
    // há limite para respeitar, então despeja tudo que sobra de uma vez. Um
    // semestre lotado de obrigatórias (`ocupado > 0`) não entra aqui: essa
    // folga zero é real e cai no caso de abrir o próximo semestre, abaixo.
    if (folga === 0 && ocupado === 0) {
      atual.horasOptativas += optativas;
      atual.horasComplementares += complementares;
      optativas = 0;
      complementares = 0;
      indice += 1;
      continue;
    }

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

/** O último semestre do histórico, ou null para quem não tem nenhum cursado. */
function ultimoSemestreCursado(historico: Historico): string | null {
  const semestres = historico.cursados.map((c) => c.semestre).sort(compararSemestres);
  return semestres[semestres.length - 1] ?? null;
}

/**
 * O semestre da data de emissão do histórico: janeiro a junho é ".1", julho a
 * dezembro é ".2". `emitidoEm` é uma data ISO ("AAAA-MM-DD"), e é dado de
 * entrada — nada aqui olha o relógio.
 */
function semestreDaEmissao(emitidoEm: string): string {
  const [ano, mes] = emitidoEm.split('-');
  return `${ano}.${Number(mes) <= 6 ? 1 : 2}`;
}

/**
 * O semestre em que a projeção começa: o seguinte ao último do histórico.
 *
 * Sem nenhum cursado não há "seguinte", e cair no `prazoConclusaoPadrao`
 * jogaria a projeção inteira para o fim do curso — o calouro veria a primeira
 * matéria em 2030.2. Nesse caso vale o semestre da emissão do histórico, e não
 * o seguinte a ele: nada foi cursado ainda, então o semestre corrente é
 * justamente onde a projeção começa.
 */
function primeiroSemestreFuturo(ultimoCursado: string | null, historico: Historico): string {
  return ultimoCursado ? proximoSemestre(ultimoCursado) : semestreDaEmissao(historico.emitidoEm);
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
  // Uma posição além do jubilamento é grampeada no prazo máximo: planejar
  // depois dele não quer dizer nada, e o regex do DTO aceita qualquer ano de
  // quatro dígitos — um "9999.2" gravado no plano faria a projeção crescer
  // por milhares de semestres e travar a própria tela que desfaria o
  // movimento. O grampo de baixo (posição vencida cai no primeiro semestre)
  // já vem do `<=` em `alocar`.
  const fixos = new Map(
    overrides.flatMap((item) =>
      item.semestre
        ? [
            [
              item.codigo,
              compararSemestres(item.semestre, historico.prazoConclusaoMaximo) > 0
                ? historico.prazoConclusaoMaximo
                : item.semestre,
            ] as const,
          ]
        : [],
    ),
  );
  const ultimoCursado = ultimoSemestreCursado(historico);
  const primeiro = primeiroSemestreFuturo(ultimoCursado, historico);

  const alocados = compactarSemestres(
    alocar(fila, fixos, codigosConcluidos(historico, marcos), primeiro, teto),
    primeiro,
  );
  // Zero, não historico.cargaHoraria.*.pendente: sem uma feature de seleção
  // de optativas, derramar essas horas gera um bloco genérico que a tela
  // mostra como se fosse uma decisão real — é ruído, não informação. Volta
  // a usar o pendente de optativas quando essa feature existir;
  // complementares fica sempre zerado aqui (não há seleção equivalente
  // planejada pra ela).
  const semestres = derramarHorasGenericas(
    alocados,
    0,
    0,
    teto,
    primeiro,
  );

  // Sem nada pendente (fila e horas genéricas vazias), `semestres` sai vazio:
  // quem terminou tudo concluiu no último semestre que cursou, não no
  // seguinte — `primeiro` já é futuro por construção e reportaria uma
  // conclusão que nunca aconteceu.
  const conclusaoProjetada = semestres[semestres.length - 1]?.semestre ?? ultimoCursado ?? primeiro;

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
