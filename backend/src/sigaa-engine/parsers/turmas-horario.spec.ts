import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurmasHorario } from './turmas-horario';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'portal-discente-turmas.html',
);

describe('parseTurmasHorario', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('parses every turma row in the "Minhas Turmas" table', () => {
    const turmas = parseTurmasHorario(html);

    expect(turmas).toHaveLength(2);
  });

  it('extracts the componente curricular name, stripping the turma sub-label', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.componente).toBe('ENG999 - LABORATÓRIO INTEGRADO III-A');
  });

  it('keeps the raw local text for the short-acronym format', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.local).toBe('ENG (ENG)');
  });

  it('keeps the raw local text for the detailed room/day format', () => {
    const [, second] = parseTurmasHorario(html);

    expect(second.local).toBe(
      'PAF 1 - 208 - Terça Horários 18:30 às 19:25, Quinta Horários 18:30 às 19:25',
    );
  });

  it('extracts the raw schedule code and validity period', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.codigoHorario).toBe('2N34');
    expect(first.vigencia).toEqual({ inicio: '19/08/2026', fim: '19/12/2026' });
  });

  it('translates the schedule code into structured days/shift/timeRanges', () => {
    const [first, second] = parseTurmasHorario(html);

    expect(first.horario.label).toBe('Segunda - Noite (20h20 - 22h10)');
    expect(second.horario.label).toBe('Terça e Quinta - Noite (18h30 - 20h20)');
  });

  it('tags each turma with the semester header it appeared under', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.semestre).toBe('2026.2');
  });

  it('returns an empty list for a table with no turma rows', () => {
    const emptyHtml =
      '<table><thead><tr><th>Componente Curricular</th></tr></thead><tbody></tbody></table>';

    expect(parseTurmasHorario(emptyHtml)).toEqual([]);
  });
});
