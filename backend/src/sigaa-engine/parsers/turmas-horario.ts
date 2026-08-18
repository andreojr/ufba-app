import * as cheerio from 'cheerio';
import { parseSigaaScheduleCode, ParsedScheduleCode } from '../schedule-code';

export interface Vigencia {
  inicio: string;
  fim: string;
}

export interface Turma {
  componente: string;
  local: string;
  codigoHorario: string;
  vigencia: Vigencia;
  horario: ParsedScheduleCode;
  semestre: string;
}

const SEMESTER_HEADER_PATTERN = /^\d{4}\.\d$/;
const SCHEDULE_CELL_PATTERN = /^(\S+)\s*\(([\d/]+)\s*-\s*([\d/]+)\)$/;

export function parseTurmasHorario(html: string): Turma[] {
  const $ = cheerio.load(html);
  const turmas: Turma[] = [];

  let currentSemester = '';

  $('tbody > tr').each((_, row) => {
    const cells = $(row).find('td');

    // Semester header rows are a single colspan'd cell (e.g. "2026.2")
    if (cells.length === 1) {
      const text = $(cells[0]).text().trim();
      if (SEMESTER_HEADER_PATTERN.test(text)) {
        currentSemester = text;
      }
      return;
    }

    const descricaoCell = $(row).find('td.descricao');
    const infoCells = $(row).find('td.info');
    if (descricaoCell.length === 0 || infoCells.length < 2) {
      return;
    }

    const componente = descricaoCell.find('span').first().text().trim();
    const local = $(infoCells[0]).text().trim();
    const scheduleText = $(infoCells[1]).text().trim();

    const match = SCHEDULE_CELL_PATTERN.exec(scheduleText);
    if (!match) {
      return;
    }
    const [, codigoHorario, inicio, fim] = match;

    turmas.push({
      componente,
      local,
      codigoHorario,
      vigencia: { inicio, fim },
      horario: parseSigaaScheduleCode(codigoHorario),
      semestre: currentSemester,
    });
  });

  return turmas;
}
