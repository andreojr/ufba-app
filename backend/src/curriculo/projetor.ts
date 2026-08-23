import { avaliarPreRequisito } from './avaliador-prerequisito';
import type { ItemFila } from './fila-de-pendentes';
import { proximoSemestre } from './semestre';

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
  const semestres: SemestreProjetado[] = [];

  let semestre = primeiroSemestre;
  while (pendentes.length > 0 || fixadas.length > 0) {
    const componentes: ComponenteProjetado[] = [];
    let capacidade = teto;

    // Posições fixas primeiro: o aluno já decidiu, e elas cobram o teto antes
    // de o projetor escolher qualquer coisa.
    for (let i = fixadas.length - 1; i >= 0; i -= 1) {
      if (fixos.get(fixadas[i].codigo) === semestre) {
        componentes.push(projetar(fixadas[i], { manual: true, naoVerificado: false }));
        capacidade -= fixadas[i].cargaHoraria;
        fixadas.splice(i, 1);
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
    }
    semestres.push({ semestre, componentes, horasOptativas: 0, horasComplementares: 0 });
    semestre = proximoSemestre(semestre);
  }

  return semestres;
}
