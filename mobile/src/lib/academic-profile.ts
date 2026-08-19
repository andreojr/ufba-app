const PERIODO_PATTERN = /^(\d{4})\.([12])$/;

/**
 * How many semesters (inclusive) the student has been at UFBA, counting from
 * the período de ingresso (e.g. "2022.1") through the current semester.
 * Months January–June count as the .1 semester, July–December as .2.
 * Returns null when the período is missing, malformed, or in the future.
 */
export function countSemestresNaUfba(
  periodoIngresso: string | null | undefined,
  now: Date,
): number | null {
  const match = periodoIngresso ? PERIODO_PATTERN.exec(periodoIngresso) : null;
  if (!match) {
    return null;
  }

  const ingressoYear = Number(match[1]);
  const ingressoSemester = Number(match[2]);
  const currentSemester = now.getMonth() < 6 ? 1 : 2;

  const count =
    (now.getFullYear() - ingressoYear) * 2 +
    (currentSemester - ingressoSemester) +
    1;
  return count >= 1 ? count : null;
}

/**
 * SIGAA's curso string bundles everything after a slash — unit, city,
 * modality, shift, degree ("ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador ...").
 * For display only the actual course name (before the slash) matters; the raw
 * string stays stored as-is server-side.
 */
export function formatCursoNome(curso: string): string {
  return curso.split("/")[0].trim();
}

/**
 * "8º semestre" — the ordinal of the semester currently in progress.
 * countSemestresNaUfba is inclusive of the running semester, so phrasing it
 * as elapsed time ("Há 8 semestres") overstated it by one for the reader.
 */
export function formatTempoNaUfba(count: number): string {
  return `${count}º semestre`;
}
