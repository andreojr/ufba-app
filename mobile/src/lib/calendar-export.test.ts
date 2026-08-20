import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import { CalendarPermissionDeniedError, exportScheduleToDeviceCalendar } from "./calendar-export";
import type { PeriodoLetivo, Turma } from "./types";

jest.mock("expo-calendar", () => ({
  requestCalendarPermissionsAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  createCalendarAsync: jest.fn(),
  deleteCalendarAsync: jest.fn(),
  createEventAsync: jest.fn(),
  getDefaultCalendarAsync: jest.fn(),
  EntityTypes: { EVENT: "event" },
  Frequency: { WEEKLY: "weekly" },
  CalendarAccessLevel: { OWNER: "owner" },
  SourceType: { LOCAL: "local" },
}));

const mockedRequestPermissions = jest.mocked(Calendar.requestCalendarPermissionsAsync);
const mockedGetCalendars = jest.mocked(Calendar.getCalendarsAsync);
const mockedCreateCalendar = jest.mocked(Calendar.createCalendarAsync);
const mockedDeleteCalendar = jest.mocked(Calendar.deleteCalendarAsync);
const mockedCreateEvent = jest.mocked(Calendar.createEventAsync);
const mockedGetDefaultCalendar = jest.mocked(Calendar.getDefaultCalendarAsync);

const PERIODO: PeriodoLetivo = {
  semestre: "2026.2",
  // 2026-08-17 is a Monday.
  inicio: "2026-08-17",
  fim: "2026-12-18",
};

function turma(overrides: Partial<Turma> = {}): Turma {
  return {
    codigo: "MATA37",
    nome: "Cálculo A",
    docente: "Fulano de Tal",
    slots: [
      {
        dia: "Segunda",
        inicioMin: 420, // 07:00
        fimMin: 475, // 07:55
        predio: "Pavilhão de Aulas",
        sala: "104",
        localOriginal: "Pavilhão de Aulas - 104",
      },
    ],
    vigencia: { inicio: "17/08/2026", fim: "18/12/2026" },
    semestre: "2026.2",
    ...overrides,
  };
}

describe("exportScheduleToDeviceCalendar", () => {
  beforeEach(() => {
    Platform.OS = "ios";
    mockedRequestPermissions.mockResolvedValue({ status: "granted" } as any);
    mockedGetCalendars.mockResolvedValue([]);
    mockedCreateCalendar.mockResolvedValue("cal-new");
    mockedDeleteCalendar.mockResolvedValue(undefined);
    mockedCreateEvent.mockResolvedValue("event-1");
    mockedGetDefaultCalendar.mockResolvedValue({
      id: "default-cal",
      source: { type: "local", name: "iCloud" },
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("throws without touching the device calendar when permission is denied", async () => {
    mockedRequestPermissions.mockResolvedValue({ status: "denied" } as any);

    await expect(exportScheduleToDeviceCalendar([turma()], PERIODO)).rejects.toThrow(
      CalendarPermissionDeniedError
    );
    expect(mockedGetCalendars).not.toHaveBeenCalled();
    expect(mockedCreateEvent).not.toHaveBeenCalled();
  });

  it("creates a fresh Gradline calendar when none exists yet", async () => {
    await exportScheduleToDeviceCalendar([turma()], PERIODO);

    expect(mockedDeleteCalendar).not.toHaveBeenCalled();
    expect(mockedCreateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Gradline" })
    );
  });

  it("deletes the previous Gradline calendar instead of duplicating it", async () => {
    mockedGetCalendars.mockResolvedValue([
      { id: "old-cal", title: "Gradline" } as any,
      { id: "other-cal", title: "Aniversários" } as any,
    ]);

    await exportScheduleToDeviceCalendar([turma()], PERIODO);

    expect(mockedDeleteCalendar).toHaveBeenCalledWith("old-cal");
    expect(mockedDeleteCalendar).toHaveBeenCalledTimes(1);
    expect(mockedCreateCalendar).toHaveBeenCalledTimes(1);
  });

  it("creates one recurring event per class slot, in the new calendar", async () => {
    await exportScheduleToDeviceCalendar([turma()], PERIODO);

    expect(mockedCreateEvent).toHaveBeenCalledTimes(1);
    const [calendarId, eventData] = mockedCreateEvent.mock.calls[0];
    expect(calendarId).toBe("cal-new");
    expect(eventData).toMatchObject({
      title: "Cálculo A",
      location: "Pavilhão de Aulas · 104",
      notes: "Fulano de Tal",
      timeZone: "America/Bahia",
      recurrenceRule: { frequency: "weekly" },
    });
    // 2026-08-17 (Monday) 07:00 BRT == 10:00 UTC.
    expect((eventData!.startDate as Date).toISOString()).toBe("2026-08-17T10:00:00.000Z");
    expect((eventData!.endDate as Date).toISOString()).toBe("2026-08-17T10:55:00.000Z");
  });

  it("clips the recurrence to a turma's own vigência when it's narrower than the term", async () => {
    await exportScheduleToDeviceCalendar(
      [turma({ vigencia: { inicio: "17/08/2026", fim: "02/10/2026" } })],
      PERIODO
    );

    const [, eventData] = mockedCreateEvent.mock.calls[0];
    const until = eventData!.recurrenceRule!.endDate as Date;
    expect(until.toISOString().slice(0, 10)).toBe("2026-10-03");
  });

  it("skips a turma whose vigência doesn't overlap the term at all", async () => {
    await exportScheduleToDeviceCalendar(
      [turma({ vigencia: { inicio: "17/08/2025", fim: "18/12/2025" } })],
      PERIODO
    );

    expect(mockedCreateEvent).not.toHaveBeenCalled();
  });

  it("resolves to the number of events created", async () => {
    const count = await exportScheduleToDeviceCalendar(
      [
        turma(),
        turma({
          codigo: "MATA42",
          nome: "Álgebra Linear",
          slots: [
            {
              dia: "Terça",
              inicioMin: 480,
              fimMin: 535,
              predio: null,
              sala: null,
              localOriginal: "Sala 2",
            },
          ],
        }),
      ],
      PERIODO
    );

    expect(count).toBe(2);
  });

  it("uses a local Android account as the calendar source instead of the default iOS calendar", async () => {
    Platform.OS = "android";

    await exportScheduleToDeviceCalendar([turma()], PERIODO);

    expect(mockedGetDefaultCalendar).not.toHaveBeenCalled();
    expect(mockedCreateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ isLocalAccount: true }) })
    );
  });
});
