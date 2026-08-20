import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import { parseIsoDate } from "./periodo-letivo";
import type { PeriodoLetivo, Turma } from "./types";

/**
 * UFBA runs on Bahia time, fixed at UTC-3 with no DST (Brazil dropped it
 * nationwide in 2019) — so every class time can be converted with one
 * constant offset instead of a timezone database.
 */
const BAHIA_UTC_OFFSET_MIN = 3 * 60;
const BAHIA_TIME_ZONE = "America/Bahia";
const MINUTES_PER_DAY = 24 * 60;

/**
 * Name of the dedicated device calendar this module owns. Re-exporting deletes and
 * recreates it, so it never accumulates duplicates. Renamed from "Gradline" as part
 * of the UFBA rebrand — anyone who exported before that still has an orphaned
 * "Gradline" calendar on their device (this lookup only matches the current title),
 * but the app wasn't published yet when this changed, so no live users are affected.
 */
const UFBA_CALENDAR_TITLE = "UFBA";
const UFBA_CALENDAR_COLOR = "#2B3A8F";

/** Maps `TurmaSlot.dia` to the JS `Date#getDay()` index. */
const WEEKDAY_TO_JS_DAY: Record<string, number> = {
  Domingo: 0,
  Segunda: 1,
  Terça: 2,
  Quarta: 3,
  Quinta: 4,
  Sexta: 5,
  Sábado: 6,
};

export class CalendarPermissionDeniedError extends Error {
  constructor() {
    super("Calendar permission was denied");
    this.name = "CalendarPermissionDeniedError";
  }
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The next date on/after `from` (inclusive) that falls on `jsWeekday`. */
function firstOccurrenceOnOrAfter(from: Date, jsWeekday: number): Date {
  const diff = (jsWeekday - from.getDay() + 7) % 7;
  return addDays(from, diff);
}

/**
 * Reads a `DD/MM/YYYY` date as a date on the local calendar. Unlike
 * `PeriodoLetivo`, a `Turma`'s `vigencia` is handed over by the SIGAA parser
 * unconverted (see backend's `atestado-turmas.ts`/`turmas-horario.ts`), so it
 * arrives in the portal's own format rather than ISO.
 */
function parseBrDate(br: string): Date {
  const [day, month, year] = br.split("/").map(Number);
  return new Date(year, month - 1, day);
}

interface DateRange {
  inicio: Date;
  fim: Date;
}

/** The overlap between a turma's vigência and the academic term, or null when they don't overlap at all. */
function intersectVigenciaWithPeriodo(
  vigencia: { inicio: string; fim: string },
  periodo: PeriodoLetivo
): DateRange | null {
  const inicioVigencia = parseBrDate(vigencia.inicio);
  const fimVigencia = parseBrDate(vigencia.fim);
  const inicioPeriodo = parseIsoDate(periodo.inicio);
  const fimPeriodo = parseIsoDate(periodo.fim);

  const inicio = inicioVigencia > inicioPeriodo ? inicioVigencia : inicioPeriodo;
  const fim = fimVigencia < fimPeriodo ? fimVigencia : fimPeriodo;
  return inicio > fim ? null : { inicio, fim };
}

/**
 * Turns a local Bahia wall-clock moment (a calendar day plus minutes since
 * its midnight) into the UTC instant it represents, carrying the day
 * rollover for classes that run past 21:00 local.
 */
function utcInstant(localDay: Date, minutesOfDay: number): Date {
  const utcMinutes = minutesOfDay + BAHIA_UTC_OFFSET_MIN;
  const dayOffset = Math.floor(utcMinutes / MINUTES_PER_DAY);
  const normalizedMinutes = utcMinutes - dayOffset * MINUTES_PER_DAY;
  const date = addDays(localDay, dayOffset);
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes)
  );
}

async function ensureCalendarPermission(): Promise<void> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== "granted") {
    throw new CalendarPermissionDeniedError();
  }
}

/**
 * The account a new calendar is filed under. iOS calendars must belong to a
 * real source on the device (the default calendar's own source works fine
 * for that), while Android is happy with a plain local, unsynced account.
 */
async function ufbaCalendarSource(): Promise<Calendar.Source> {
  if (Platform.OS === "ios") {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync();
    return defaultCalendar.source;
  }
  return { isLocalAccount: true, name: UFBA_CALENDAR_TITLE, type: Calendar.SourceType.LOCAL };
}

/**
 * Deletes any calendar this module created before (so re-exporting never
 * duplicates events) and creates a fresh one, returning its id.
 */
async function ensureFreshUfbaCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find((calendar) => calendar.title === UFBA_CALENDAR_TITLE);
  if (existing) {
    await Calendar.deleteCalendarAsync(existing.id);
  }

  const source = await ufbaCalendarSource();
  return Calendar.createCalendarAsync({
    title: UFBA_CALENDAR_TITLE,
    color: UFBA_CALENDAR_COLOR,
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: source.id,
    source,
    name: UFBA_CALENDAR_TITLE,
    ownerAccount: "ufba",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

/**
 * Exports the given schedule as native, recurring calendar events — one per
 * class slot, weekly through the end of the academic term (or the turma's
 * own `vigência`, whichever is narrower). Events land in a dedicated
 * "UFBA" calendar rather than the user's own, which this function
 * deletes and recreates on every call so re-exporting never duplicates
 * events. Throws `CalendarPermissionDeniedError` if the user declines
 * calendar access.
 */
export async function exportScheduleToDeviceCalendar(
  turmas: Turma[],
  periodoLetivo: PeriodoLetivo
): Promise<number> {
  await ensureCalendarPermission();
  const calendarId = await ensureFreshUfbaCalendar();

  let count = 0;
  for (const turma of turmas) {
    const range = intersectVigenciaWithPeriodo(turma.vigencia, periodoLetivo);
    if (!range) {
      continue;
    }

    for (const slot of turma.slots) {
      const jsWeekday = WEEKDAY_TO_JS_DAY[slot.dia];
      if (jsWeekday === undefined) {
        console.warn(`Skipping calendar event for unknown weekday: "${slot.dia}"`);
        continue;
      }

      const dtStartDay = firstOccurrenceOnOrAfter(range.inicio, jsWeekday);
      if (dtStartDay > range.fim) {
        // The term (or the turma's own vigência) ends before this weekday
        // ever comes around — nothing to schedule.
        continue;
      }

      const location = [slot.predio, slot.sala].filter(Boolean).join(" · ") || slot.localOriginal;

      await Calendar.createEventAsync(calendarId, {
        title: turma.nome,
        location,
        notes: turma.docente ?? undefined,
        timeZone: BAHIA_TIME_ZONE,
        startDate: utcInstant(dtStartDay, slot.inicioMin),
        endDate: utcInstant(dtStartDay, slot.fimMin),
        recurrenceRule: {
          frequency: Calendar.Frequency.WEEKLY,
          // End of the last day so it still covers that day's class,
          // whatever time it starts at.
          endDate: utcInstant(range.fim, MINUTES_PER_DAY - 1),
        },
      });
      count += 1;
    }
  }

  return count;
}
