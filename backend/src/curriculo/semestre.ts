/**
 * Aritmética dos períodos letivos do SIGAA, que correm ".1" e depois ".2"
 * dentro do mesmo ano. Isolado num módulo próprio porque quatro lugares
 * diferentes precisam avançar um semestre, e duas versões dessa regra
 * divergindo é um bug que só aparece na virada do ano.
 */

function partes(semestre: string): { ano: number; periodo: number } {
  const [ano, periodo] = semestre.split('.').map(Number);
  return { ano, periodo };
}

/** "2026.1" → "2026.2"; "2026.2" → "2027.1". */
export function proximoSemestre(semestre: string): string {
  const { ano, periodo } = partes(semestre);
  return periodo === 1 ? `${ano}.2` : `${ano + 1}.1`;
}

/**
 * Negativo quando `a` vem antes de `b`. O formato "AAAA.N" ordena
 * lexicograficamente por construção, então não há conversão a fazer.
 */
export function compararSemestres(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Quantos semestres separam `de` de `ate`. Negativo quando `ate` já passou —
 * deliberadamente, para que quem chama decida o que fazer com isso em vez de
 * receber um zero que esconde a inversão.
 */
export function distanciaEmSemestres(de: string, ate: string): number {
  const inicio = partes(de);
  const fim = partes(ate);
  return (fim.ano - inicio.ano) * 2 + (fim.periodo - inicio.periodo);
}
