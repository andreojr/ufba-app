import { parseSigaaScheduleCode } from '../schedule-code';
import { parseLocal } from './local';

export interface Vigencia {
  inicio: string;
  fim: string;
}

export interface TurmaSlot {
  dia: string;
  inicioMin: number;
  fimMin: number;
  predio: string | null;
  sala: string | null;
  localOriginal: string;
}

export interface Turma {
  codigo: string | null;
  nome: string;
  /** Only the atestado de matrícula carries this — null when parsed off the portal home. */
  docente: string | null;
  slots: TurmaSlot[];
  vigencia: Vigencia;
  semestre: string;
}

/**
 * Expands SIGAA's schedule notation into one slot per weekday/time range, with
 * the location resolved per day.
 *
 * Shared by both documents a schedule can be read from — the portal home's
 * "Minhas Turmas" table and the atestado de matrícula — because their
 * "Horário" and "Local" cells hold character-for-character the same text.
 *
 * `codesText` may hold more than one code (e.g. "2N12 4N34": a theory slot on
 * one day and a lab slot on another), all sharing one validity period.
 */
export function buildTurmaSlots(codesText: string, local: string): TurmaSlot[] {
  const parsedCodes = codesText
    .split(/\s+/)
    .filter(Boolean)
    .map((code) => parseSigaaScheduleCode(code));
  const allDays = Array.from(new Set(parsedCodes.flatMap((p) => p.days)));
  const locationByDay = parseLocal(local, allDays);

  const slots: TurmaSlot[] = [];
  for (const parsed of parsedCodes) {
    for (const dia of parsed.days) {
      const location = locationByDay[dia];
      for (const range of parsed.timeRanges) {
        slots.push({
          dia,
          inicioMin: range.startMinutes,
          fimMin: range.endMinutes,
          predio: location.predio,
          sala: location.sala,
          localOriginal: location.localOriginal,
        });
      }
    }
  }

  return slots;
}
