/**
 * Quantas contestações são necessárias para rebaixar um item, além de
 * superarem as confirmações. Baixo de propósito: a turma tem dezenas de
 * alunos, não milhares, e o pior caso de rebaixar é um item verdadeiro sair
 * da dobra — não um item falso ganhar autoridade.
 */
export const LIMIAR_CONTESTACAO = 3;

export type EstadoPonto = 'NORMAL' | 'CONTESTADO';

/**
 * Derivado na leitura, nunca persistido: não há job mantendo flag em dia, e
 * mudar o limiar é mudar a constante acima.
 */
export function estadoDoPonto(
  confirmacoes: number,
  contestacoes: number,
): EstadoPonto {
  return contestacoes > confirmacoes && contestacoes >= LIMIAR_CONTESTACAO
    ? 'CONTESTADO'
    : 'NORMAL';
}
