import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { buildTurmaSlots, Turma } from './turma';

/**
 * The academic term the atestado was issued for, straight from its
 * identification table — the official start/end dates of the term itself, not
 * the validity period of any single turma. Dates are ISO (`YYYY-MM-DD`) so a
 * client can build a Date without guessing the day/month order.
 */
export interface PeriodoLetivo {
  semestre: string;
  inicio: string;
  fim: string;
}

const SCHEDULE_CELL_PATTERN = /^(.+?)\s*\(([\d/]+)\s*-\s*([\d/]+)\)$/;

// "2026.2" followed by "(19/08/2026 à 19/12/2026)" — the separator is a
// non-ASCII "à" on UFBA, but other deploys have been seen using a plain dash.
const PERIODO_LETIVO_PATTERN =
  /(\d{4}\.\d)[\s\S]*?\((\d{2}\/\d{2}\/\d{4})\s*(?:à|a|-)\s*(\d{2}\/\d{2}\/\d{4})\)/;

const PERIODO_LETIVO_LABEL_PATTERN = /periodo\s+letivo/;

const ENROLLED_STATUS = 'MATRICULADO';

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeLabel(label: string): string {
  return stripAccents(label).replace(/:\s*$/, '').trim().toLowerCase();
}

function toIsoDate(brDate: string): string {
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

function parsePeriodoLetivo($: cheerio.CheerioAPI): PeriodoLetivo | null {
  let periodo: PeriodoLetivo | null = null;

  $('#identificacao tr').each((_, row) => {
    if (periodo) {
      return;
    }
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }
    // Whitespace-collapse before matching: JSF renders the label across
    // several lines ("Período\n\tLetivo:").
    const label = normalizeLabel($(cells[0]).text().replace(/\s+/g, ' '));
    if (!PERIODO_LETIVO_LABEL_PATTERN.test(label)) {
      return;
    }

    const match = PERIODO_LETIVO_PATTERN.exec($(cells[1]).text());
    if (!match) {
      return;
    }
    const [, semestre, inicio, fim] = match;
    periodo = {
      semestre,
      inicio: toIsoDate(inicio),
      fim: toIsoDate(fim),
    };
  });

  return periodo;
}

/**
 * A row counts as enrolled unless its status says otherwise. Anchoring on
 * "not MATRICULADO" rather than on a list of rejection statuses is deliberate:
 * a deploy that doesn't render the status column costs one extra turma at
 * worst, where the stricter reading would blank out the whole schedule.
 */
function isEnrolled(status: string): boolean {
  if (!status) {
    return true;
  }
  return stripAccents(status).toUpperCase() === ENROLLED_STATUS;
}

/** The location cell is prefixed with a literal `<b>Local:</b>` label. */
function readLocal(row: cheerio.Cheerio<Element>): string {
  const local = row.find('span.local').clone();
  local.find('b').remove();
  return local.text().trim();
}

/**
 * Parses the "Emitir Atestado de Matrícula" print page: the enrolled turmas
 * plus the term they belong to.
 *
 * Preferred over the portal home's "Minhas Turmas" table (see
 * `parseTurmasHorario`) because this document carries the course code and the
 * docente, which the home omits — at the cost of listing turmas the home
 * hides, hence the status filter. The "Horário" and "Local" cells are
 * character-for-character the same text in both documents, so schedule-code
 * and location parsing is shared as-is.
 */
export function parseAtestadoTurmas(html: string): {
  turmas: Turma[];
  periodoLetivo: PeriodoLetivo | null;
} {
  const $ = cheerio.load(html);
  const periodoLetivo = parsePeriodoLetivo($);
  const turmas: Turma[] = [];

  $('#matriculas tbody tr').each((_, row) => {
    const cell = $(row);
    if (!isEnrolled(cell.find('td.status').text().trim())) {
      return;
    }

    const scheduleText = cell.find('td.horario').text().trim();
    const match = SCHEDULE_CELL_PATTERN.exec(scheduleText);
    if (!match) {
      return;
    }
    const [, codesText, inicio, fim] = match;
    const codigo = cell.find('td.codigo').text().trim();
    const docente = cell.find('span.docente').text().trim();

    turmas.push({
      codigo: codigo || null,
      nome: cell.find('span.componente').text().trim(),
      numero: cell.find('td.turma').text().trim(),
      docente: docente || null,
      slots: buildTurmaSlots(codesText, readLocal(cell)),
      vigencia: { inicio, fim },
      semestre: periodoLetivo?.semestre ?? '',
    });
  });

  return { turmas, periodoLetivo };
}
