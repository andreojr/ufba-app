const CODE_PATTERN = /^([2-7]+)([MTN])(\d+)$/;

const DAY_NAMES: Record<string, string> = {
  '2': 'Segunda',
  '3': 'Terça',
  '4': 'Quarta',
  '5': 'Quinta',
  '6': 'Sexta',
  '7': 'Sábado',
};

const SHIFT_NAMES: Record<string, string> = {
  M: 'Manhã',
  T: 'Tarde',
  N: 'Noite',
};

/** [startMinutes, endMinutes] since midnight, per shift + slot index. */
const SLOT_MINUTES: Record<string, Record<string, [number, number]>> = {
  M: {
    '1': [420, 475],
    '2': [475, 530],
    '3': [530, 585],
    '4': [585, 640],
    '5': [640, 695],
    '6': [695, 750],
  },
  T: {
    '1': [780, 835],
    '2': [835, 890],
    '3': [890, 945],
    '4': [945, 1000],
    '5': [1000, 1055],
    '6': [1055, 1110],
  },
  N: {
    '1': [1110, 1165],
    '2': [1165, 1220],
    '3': [1220, 1275],
    '4': [1275, 1330],
  },
};

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${String(mins).padStart(2, '0')}`;
}

export class InvalidScheduleCodeError extends Error {
  constructor(code: string) {
    super(`Invalid SIGAA schedule code: "${code}"`);
    this.name = 'InvalidScheduleCodeError';
  }
}

export interface ScheduleTimeRange {
  startMinutes: number;
  endMinutes: number;
  label: string;
}

export interface ParsedScheduleCode {
  days: string[];
  shift: string;
  timeRanges: ScheduleTimeRange[];
  label: string;
  invalidSlots: string[];
}

export function parseSigaaScheduleCode(code: string): ParsedScheduleCode {
  const match = CODE_PATTERN.exec(code);
  if (!match) {
    throw new InvalidScheduleCodeError(code);
  }

  const [, dayDigits, shiftLetter, slotDigits] = match;

  const days = dayDigits.split('').map((digit) => DAY_NAMES[digit]);
  const shift = SHIFT_NAMES[shiftLetter];

  const slotTable = SLOT_MINUTES[shiftLetter];
  const invalidSlots: string[] = [];
  const validSlots: number[] = [];

  for (const digit of slotDigits.split('')) {
    if (slotTable[digit]) {
      validSlots.push(Number(digit));
    } else {
      invalidSlots.push(digit);
    }
  }

  validSlots.sort((a, b) => a - b);

  const timeRanges = groupConsecutiveSlots(validSlots).map((group) => {
    const startMinutes = slotTable[String(group[0])][0];
    const endMinutes = slotTable[String(group[group.length - 1])][1];
    return {
      startMinutes,
      endMinutes,
      label: `${formatMinutes(startMinutes)} - ${formatMinutes(endMinutes)}`,
    };
  });

  const label = `${days.join(' e ')} - ${shift} (${timeRanges
    .map((range) => range.label)
    .join(', ')})`;

  return { days, shift, timeRanges, label, invalidSlots };
}

function groupConsecutiveSlots(slots: number[]): number[][] {
  const groups: number[][] = [];

  for (const slot of slots) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && slot === lastGroup[lastGroup.length - 1] + 1) {
      lastGroup.push(slot);
    } else {
      groups.push([slot]);
    }
  }

  return groups;
}
