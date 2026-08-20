import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteDisciplinas } from './docente-disciplinas';
import { parseSigaaScheduleCode } from '../schedule-code';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'docente-disciplinas.html'),
  'utf-8',
);

describe('parseDocenteDisciplinas', () => {
  it('attaches every row to the anoPeriodo heading above it', () => {
    const disciplinas = parseDocenteDisciplinas(fixture);
    expect(disciplinas.length).toBeGreaterThan(0);
    expect(disciplinas.every((d) => /^\d{4}\.\d$/.test(d.semestre))).toBe(true);
  });

  it('reads codigo, nome and carga horária as a number', () => {
    const primeira = parseDocenteDisciplinas(fixture)[0];
    expect(primeira.codigo).toMatch(/^[A-Z]{3,4}\d{2,3}$/);
    expect(primeira.nome.length).toBeGreaterThan(0);
    expect(Number.isInteger(primeira.cargaHoraria)).toBe(true);
    expect(primeira.cargaHoraria).toBeGreaterThan(0);
  });

  it('keeps o horário verbatim, in the form schedule-code.ts already parses', () => {
    const comHorario = parseDocenteDisciplinas(fixture).find((d) => d.horario.length > 0);
    expect(comHorario).toBeDefined();
    const codigo = comHorario!.horario.split(' ')[0];
    expect(parseSigaaScheduleCode(codigo).timeRanges.length).toBeGreaterThan(0);
  });

  it('returns an empty list rather than throwing when there is no listing', () => {
    expect(parseDocenteDisciplinas('<html><body></body></html>')).toEqual([]);
  });
});
