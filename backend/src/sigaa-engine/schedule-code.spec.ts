import {
  parseSigaaScheduleCode,
  InvalidScheduleCodeError,
} from './schedule-code';

describe('parseSigaaScheduleCode', () => {
  it('parses a single-day night code with consecutive slots (2N34)', () => {
    const result = parseSigaaScheduleCode('2N34');

    expect(result).toEqual({
      days: ['Segunda'],
      shift: 'Noite',
      timeRanges: ['20h20 - 22h10'],
      label: 'Segunda - Noite (20h20 - 22h10)',
      invalidSlots: [],
    });
  });

  it('parses a two-day night code with consecutive slots (35N12)', () => {
    const result = parseSigaaScheduleCode('35N12');

    expect(result).toEqual({
      days: ['Terça', 'Quinta'],
      shift: 'Noite',
      timeRanges: ['18h30 - 20h20'],
      label: 'Terça e Quinta - Noite (18h30 - 20h20)',
      invalidSlots: [],
    });
  });

  it('sorts out-of-order slots before grouping consecutive ranges', () => {
    // same slots as 2N34 but written out of order in the source code
    const result = parseSigaaScheduleCode('2N43');

    expect(result.timeRanges).toEqual(['20h20 - 22h10']);
  });

  it('produces separate ranges for non-consecutive slots', () => {
    const result = parseSigaaScheduleCode('2M136');

    expect(result.timeRanges).toEqual([
      '7h00 - 7h55',
      '8h50 - 9h45',
      '11h35 - 12h30',
    ]);
  });

  it('flags slots that do not exist in the time table instead of silently dropping them', () => {
    // Noite only has slots 1-4; slot 5 is invalid for that shift
    const result = parseSigaaScheduleCode('2N45');

    expect(result.invalidSlots).toEqual(['5']);
    expect(result.timeRanges).toEqual(['21h15 - 22h10']);
  });

  it('throws for a code that does not match the day/shift/slot format', () => {
    expect(() => parseSigaaScheduleCode('XYZ')).toThrow(
      InvalidScheduleCodeError,
    );
  });

  it('throws for a code with no shift letter (implicitly rejects multiple shifts too)', () => {
    expect(() => parseSigaaScheduleCode('234')).toThrow(
      InvalidScheduleCodeError,
    );
  });

  it('throws for an empty string', () => {
    expect(() => parseSigaaScheduleCode('')).toThrow(InvalidScheduleCodeError);
  });
});
