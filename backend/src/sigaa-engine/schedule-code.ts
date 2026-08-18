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

const SLOT_TIMES: Record<string, Record<string, [string, string]>> = {
  M: {
    '1': ['7h00', '7h55'],
    '2': ['7h55', '8h50'],
    '3': ['8h50', '9h45'],
    '4': ['9h45', '10h40'],
    '5': ['10h40', '11h35'],
    '6': ['11h35', '12h30'],
  },
  T: {
    '1': ['13h00', '13h55'],
    '2': ['13h55', '14h50'],
    '3': ['14h50', '15h45'],
    '4': ['15h45', '16h40'],
    '5': ['16h40', '17h35'],
    '6': ['17h35', '18h30'],
  },
  N: {
    '1': ['18h30', '19h25'],
    '2': ['19h25', '20h20'],
    '3': ['20h20', '21h15'],
    '4': ['21h15', '22h10'],
  },
};

export class InvalidScheduleCodeError extends Error {
  constructor(code: string) {
    super(`Invalid SIGAA schedule code: "${code}"`);
    this.name = 'InvalidScheduleCodeError';
  }
}

export interface ParsedScheduleCode {
  days: string[];
  shift: string;
  timeRanges: string[];
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

  const slotTable = SLOT_TIMES[shiftLetter];
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

  const timeRanges = groupConsecutiveSlots(validSlots).map(
    (group) =>
      `${slotTable[String(group[0])][0]} - ${slotTable[String(group[group.length - 1])][1]}`,
  );

  const label = `${days.join(' e ')} - ${shift} (${timeRanges.join(', ')})`;

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
