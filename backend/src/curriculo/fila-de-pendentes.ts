import type { ComponentePendente } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';

/**
 * O histórico lista o ENADE entre os pendentes obrigatórios, mas ele não é
 * componente curricular — não tem período, não tem carga, e planejar em que
 * semestre fazê-lo não quer dizer nada.
 */
const CODIGO_ENADE = 'ENADE';

export interface ItemFila {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null só na obsoleta pura: nenhum componente ativo com esse código. */
  periodo: number | null;
  atrasada: boolean;
  /** Texto cru da grade ativa, para o `avaliarPreRequisito`. */
  preRequisito: string | null;
  /**
   * O código da grade ativa que declara esta pendente como equivalente, ou
   * null quando ela mesma está na grade. Cursar esta satisfaz um pré-requisito
   * escrito com aquele — é a mesma regra que `codigosConcluidos` aplica ao
   * histórico, aqui estendida ao que a projeção ainda vai concluir.
   */
  substituto: string | null;
}

/**
 * A fila que o projetor consome, na ordem em que ele deve tentar alocar.
 *
 * A ordenação por período faz as atrasadas saírem primeiro por construção, sem
 * regra especial: período menor vem antes, e atrasada é justamente a de período
 * menor que o atual.
 *
 * Uma pendente pode não existir na grade ativa, porque o histórico cobra
 * segundo o currículo *do aluno* e nós resolvemos sempre a Ativa. Quando a
 * grade nova declara equivalência, a pendente herda o período do substituto e
 * é alocada com dado real — esse é o caso comum. Quando ninguém a menciona
 * (obsoleta pura), ela vai para o fim da fila sem período: não é atraso, é
 * divergência de catálogo, e não merece o mesmo senso de urgência.
 */
export function montarFila(
  pendentes: ComponentePendente[],
  componentes: ComponenteCurricularSalvo[],
  equivalencias: { codigo: string; equivalenteDe: string }[],
  periodoLetivoAtual: number,
): ItemFila[] {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  const substitutoDe = new Map(equivalencias.map((e) => [e.codigo, e.equivalenteDe]));

  const itens = pendentes
    .filter((p) => !p.matriculado && p.codigo !== CODIGO_ENADE)
    .map((pendente): ItemFila => {
      const naGradePeloProprioCodigo = porCodigo.get(pendente.codigo);
      // Mesma precedência do `classificarComponente`: quem está na grade ativa
      // é "atual" e não substitui ninguém, ainda que alguma equivalência cite
      // o código.
      const substituto = naGradePeloProprioCodigo
        ? undefined
        : substitutoDe.get(pendente.codigo);
      const naGrade =
        naGradePeloProprioCodigo ?? (substituto ? porCodigo.get(substituto) : undefined);
      const periodo = naGrade?.periodo ?? null;
      return {
        codigo: pendente.codigo,
        nome: pendente.nome,
        cargaHoraria: pendente.cargaHoraria,
        periodo,
        atrasada: periodo !== null && periodo < periodoLetivoAtual,
        preRequisito: naGrade?.preRequisito ?? null,
        substituto: substituto ?? null,
      };
    });

  // Sem período vai para o fim. O desempate por código não é estético: sem ele
  // duas leituras seguidas do mesmo histórico podem devolver projeções
  // diferentes, e o aluno vê a timeline se remexer sozinha.
  return itens.sort((a, b) => {
    const periodoA = a.periodo ?? Number.MAX_SAFE_INTEGER;
    const periodoB = b.periodo ?? Number.MAX_SAFE_INTEGER;
    return periodoA - periodoB || a.codigo.localeCompare(b.codigo);
  });
}
