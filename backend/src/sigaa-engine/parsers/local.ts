/**
 * Parses the free-text "Local" column from the SIGAA portal home ("Minhas
 * Turmas" table) into structured predio/sala per weekday, when possible.
 *
 * This is professor-typed free text — there is no guaranteed format. We try
 * a few known patterns (observed on real portal data) in order of
 * specificity and fall back to preserving the raw text untouched when none
 * match. `localOriginal` is always populated so nothing is ever lost, even
 * when the structured fields can't be extracted.
 */

export interface LocalInfo {
  predio: string | null;
  sala: string | null;
  localOriginal: string;
}

const DAY_ABBREVIATIONS: Record<string, string> = {
  seg: 'Segunda',
  ter: 'Terça',
  qua: 'Quarta',
  qui: 'Quinta',
  sex: 'Sexta',
  sab: 'Sábado',
};

const FULL_DAY_NAMES = [
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pattern A: per-day distinct location, e.g.
 * "Ter PAF I/Qui Smart Class III" — abbreviated day name + free-text
 * location, one segment per day, joined by "/". No sala is split out here
 * since the text after the day abbreviation is itself freeform.
 */
function tryPerDayPattern(local: string): Record<string, LocalInfo> | null {
  const segments = local.split('/').map((segment) => segment.trim());
  if (segments.length < 2) {
    return null;
  }

  const result: Record<string, LocalInfo> = {};

  for (const segment of segments) {
    const match = /^(\S{3})\.?\s+(.+)$/.exec(segment);
    if (!match) {
      return null;
    }
    const [, abbrev, place] = match;
    const day = DAY_ABBREVIATIONS[stripAccents(abbrev).toLowerCase()];
    if (!day) {
      return null;
    }
    result[day] = { predio: place.trim(), sala: null, localOriginal: local };
  }

  return result;
}

/**
 * Pattern B: fixed predio/sala, described once (or repeated verbatim per
 * day/time), e.g. "PAF 1 - 208 - Terça Horários 18:30 às 19:25PAF 1 - 208 -
 * Quinta Horários 18:30 às 19:25". We only need the first occurrence of
 * "<predio> - <sala> -" since it repeats identically per day in this format.
 */
function tryFixedPredioSalaPattern(local: string): LocalInfo | null {
  const dayAlternation = FULL_DAY_NAMES.join('|');
  const pattern = new RegExp(
    `^(.+?)\\s*-\\s*(.+?)\\s*-\\s*(?:${dayAlternation})\\b`,
  );
  const match = pattern.exec(local);
  if (!match) {
    return null;
  }
  const [, predio, sala] = match;
  return { predio: predio.trim(), sala: sala.trim(), localOriginal: local };
}

/**
 * Pattern C: predio-only, no sala assigned yet, e.g. "ENG (ENG)".
 */
function tryPredioOnlyPattern(local: string): LocalInfo | null {
  const match = /^(.+?)\s*\((\S+)\)$/.exec(local.trim());
  if (!match) {
    return null;
  }
  const [, , sigla] = match;
  return { predio: sigla.trim(), sala: null, localOriginal: local };
}

/**
 * Resolves predio/sala for each of the given weekdays from the raw "Local"
 * text. Returns one `LocalInfo` per day in `days`, falling back to
 * `{ predio: null, sala: null, localOriginal: local }` for any day this
 * couldn't confidently parse.
 */
export function parseLocal(
  local: string,
  days: string[],
): Record<string, LocalInfo> {
  const fallback: LocalInfo = {
    predio: null,
    sala: null,
    localOriginal: local,
  };

  const perDay = tryPerDayPattern(local);
  if (perDay) {
    const result: Record<string, LocalInfo> = {};
    for (const day of days) {
      result[day] = perDay[day] ?? fallback;
    }
    return result;
  }

  const uniform =
    tryFixedPredioSalaPattern(local) ?? tryPredioOnlyPattern(local) ?? fallback;
  const result: Record<string, LocalInfo> = {};
  for (const day of days) {
    result[day] = uniform;
  }
  return result;
}
