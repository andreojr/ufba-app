/**
 * Canonical form for matching a docente name across two sources that spell it
 * differently: the atestado de matrícula and SIGAA's public registry (which
 * holds accented and mixed-case entries alike).
 *
 * The ASCII output is load-bearing for a second reason: SIGAA reads the search
 * POST body as ISO-8859-1, and a UTF-8 accent comes back as a silent 200 with
 * no results table and no error message. The search itself is
 * accent-insensitive, so normalising costs nothing and removes the hazard.
 */
export function normalizarNomeDocente(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
