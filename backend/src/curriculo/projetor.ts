import { avaliarPreRequisito } from './avaliador-prerequisito';
import type { ItemFila } from './fila-de-pendentes';
import { compararSemestres, proximoSemestre } from './semestre';

/**
 * Teto duro de semestres projetados — trinta anos de graduação, muito além de
 * qualquer prazo de jubilamento. Bater aqui já é sintoma de dado absurdo (um
 * override apontando para "9999.2", por exemplo), não de aluno atrasado.
 *
 * É rede de segurança da função pura: `alocar` não pode ser levada a correr
 * sem fim — nem a devolver dezenas de milhares de semestres — por chamador
 * nenhum, hoje ou depois. Ao bater o teto, o que sobrou é despejado no último
 * semestre em vez de descartado: uma projeção estranha ainda diz onde cada
 * matéria está, uma projeção com matéria sumida mente.
 */
export const MAX_SEMESTRES_PROJETADOS = 60;

export interface ComponenteProjetado {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  periodo: number | null;
  atrasada: boolean;
  /** Veio de um PlanoItem: o aluno pôs aqui, o projetor não escolheu. */
  manual: boolean;
  /** Alocado pela válvula, sem conseguir confirmar o pré-requisito. */
  preRequisitoNaoVerificado: boolean;
}

export interface SemestreProjetado {
  semestre: string;
  componentes: ComponenteProjetado[];
  /** Sempre 0 aqui — `derramarHorasGenericas` é quem preenche. */
  horasOptativas: number;
  horasComplementares: number;
}

function projetar(item: ItemFila, opcoes: { manual: boolean; naoVerificado: boolean }): ComponenteProjetado {
  return {
    codigo: item.codigo,
    nome: item.nome,
    cargaHoraria: item.cargaHoraria,
    periodo: item.periodo,
    atrasada: item.atrasada,
    manual: opcoes.manual,
    preRequisitoNaoVerificado: opcoes.naoVerificado,
  };
}

/**
 * Distribui a fila pelos semestres futuros. Guloso e determinístico: a cada
 * semestre percorre a fila em ordem e pega tudo que está liberado e cabe.
 *
 * `aprovados` só cresce no **fim** de cada semestre, nunca durante. É isso que
 * impede uma matéria e o pré-requisito dela de caírem juntos: dentro de um
 * semestre, nada que foi alocado ali conta como cursado.
 *
 * O laço precisa terminar, e duas condições ameaçam isso: um semestre em que
 * nada é liberado (pré-requisito citando código fora da grade, ou o texto de
 * "carga horária mínima", que o avaliador reprova por design) e um componente
 * maior que o teto. Ambas viram alocação forçada, não travamento — a diferença
 * entre "a projeção errou uma matéria" e "o endpoint não responde".
 */
export function alocar(
  fila: ItemFila[],
  fixos: ReadonlyMap<string, string>,
  aprovados: ReadonlySet<string>,
  primeiroSemestre: string,
  teto: number,
): SemestreProjetado[] {
  const pendentes = fila.filter((item) => !fixos.has(item.codigo));
  const fixadas = fila.filter((item) => fixos.has(item.codigo));
  const concluidos = new Set(aprovados);
  // Fora do `ComponenteProjetado` de propósito: o substituto é insumo do
  // cálculo, não campo do payload que a tela desenha.
  const substitutoDe = new Map(
    fila.flatMap((item) => (item.substituto ? [[item.codigo, item.substituto] as const] : [])),
  );
  const semestres: SemestreProjetado[] = [];

  let semestre = primeiroSemestre;
  while (pendentes.length > 0 || fixadas.length > 0) {
    const componentes: ComponenteProjetado[] = [];
    let capacidade = teto;

    // Posições fixas primeiro: o aluno já decidiu, e elas cobram o teto antes
    // de o projetor escolher qualquer coisa. "Já venceu ou é agora" em vez de
    // igualdade exata: um override para um semestre que a sequência nunca
    // gera (ex.: um PlanoItem que envelheceu e aponta para o passado) precisa
    // ser alcançado assim que o laço o ultrapassa, senão `fixadas` nunca
    // esvazia e o `while` gira para sempre.
    for (let i = 0; i < fixadas.length; i += 1) {
      if (compararSemestres(fixos.get(fixadas[i].codigo)!, semestre) <= 0) {
        componentes.push(projetar(fixadas[i], { manual: true, naoVerificado: false }));
        capacidade -= fixadas[i].cargaHoraria;
        fixadas.splice(i, 1);
        i -= 1;
      }
    }

    for (let i = 0; i < pendentes.length; i += 1) {
      const item = pendentes[i];
      if (item.cargaHoraria > capacidade) {
        continue;
      }
      if (!avaliarPreRequisito(item.preRequisito, concluidos)) {
        continue;
      }
      componentes.push(projetar(item, { manual: false, naoVerificado: false }));
      capacidade -= item.cargaHoraria;
      pendentes.splice(i, 1);
      i -= 1;
    }

    // Válvula: o semestre não recebeu nada e ainda há fila. Sem isso, um
    // pré-requisito insatisfazível ou um componente maior que o teto giram
    // para sempre.
    if (componentes.length === 0 && pendentes.length > 0) {
      const item = pendentes.shift()!;
      componentes.push(
        projetar(item, {
          manual: false,
          naoVerificado: !avaliarPreRequisito(item.preRequisito, concluidos),
        }),
      );
    }

    for (const componente of componentes) {
      concluidos.add(componente.codigo);
      // O código da grade ativa conta junto: uma pendente de grade antiga
      // alocada aqui precisa satisfazer o pré-requisito escrito com o código
      // novo, do mesmo jeito que satisfaria se já estivesse no histórico.
      const substituto = substitutoDe.get(componente.codigo);
      if (substituto) {
        concluidos.add(substituto);
      }
    }
    semestres.push({ semestre, componentes, horasOptativas: 0, horasComplementares: 0 });

    // Ver `MAX_SEMESTRES_PROJETADOS`: o que sobrou cai neste último semestre,
    // porque perder item é pior que uma projeção estranha.
    if (semestres.length === MAX_SEMESTRES_PROJETADOS) {
      for (const item of fixadas) {
        componentes.push(projetar(item, { manual: true, naoVerificado: false }));
      }
      for (const item of pendentes) {
        componentes.push(
          projetar(item, {
            manual: false,
            naoVerificado: !avaliarPreRequisito(item.preRequisito, concluidos),
          }),
        );
      }
      break;
    }

    semestre = proximoSemestre(semestre);
  }

  return semestres;
}

/**
 * Remove semestres sem nenhum componente e renumera os que sobraram,
 * fechando o buraco — nunca é exibido um semestre futuro vazio no meio da
 * linha do tempo. `alocar` já pode produzir isso hoje (uma posição fixa bem
 * distante, sem pendentes soltos pra preencher o meio caminho), e é
 * exatamente o caso que o arrasto do grid explora ao mover a última matéria
 * pra fora de um semestre. Ver
 * docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
export function compactarSemestres(
  semestres: SemestreProjetado[],
  primeiroSemestre: string,
): SemestreProjetado[] {
  const naoVazios = semestres.filter((semestre) => semestre.componentes.length > 0);
  let semestre = primeiroSemestre;
  return naoVazios.map((atual) => {
    const renomeado = { ...atual, semestre };
    semestre = proximoSemestre(semestre);
    return renomeado;
  });
}
