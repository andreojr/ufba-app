/**
 * `semestresLecionando` (a raw count from `DocenteSelos`) means nothing to a
 * student on its own — "60 semestres" takes real arithmetic to place. A
 * single semester stays as-is (a fraction of a year would read stranger than
 * the raw count), but two or more collapse into whole years, the unit a
 * "tempo de casa" is actually felt in.
 *
 * Floored, not rounded: 3 semestres is one *complete* year plus a semester
 * still in progress, not two — rounding up would claim a year that has not
 * finished yet. Same call `countSemestresNaUfba` makes elsewhere about not
 * overstating elapsed time.
 */
export function formatTempoLecionando(semestres: number): string {
  if (semestres <= 1) {
    return "Há 1 semestre";
  }
  const anos = Math.floor(semestres / 2);
  return `Há ${anos} ${anos === 1 ? "ano" : "anos"}`;
}
