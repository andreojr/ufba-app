import * as cheerio from 'cheerio';
import { buildTurmaSlots, TurmaPortal } from './turma';

const SEMESTER_HEADER_PATTERN = /^\d{4}\.\d$/;
// A turma can have more than one schedule code in the same cell (e.g. a
// theory slot on one day and a lab slot on another: "2N12 4N34"), sharing a
// single trailing validity period — group 1 captures all of them together.
const SCHEDULE_CELL_PATTERN = /^(.+?)\s*\(([\d/]+)\s*-\s*([\d/]+)\)$/;
const COMPONENTE_CODE_PATTERN = /^([A-Z]{2,4}\d{2,3})\s*-\s*(.+)$/;

function splitCodigoNome(componente: string): {
  codigo: string | null;
  nome: string;
} {
  const match = COMPONENTE_CODE_PATTERN.exec(componente);
  if (!match) {
    return { codigo: null, nome: componente };
  }
  const [, codigo, nome] = match;
  return { codigo, nome };
}

/**
 * Parses the "Minhas Turmas" table of the portal discente home.
 *
 * This is the fallback source for the schedule — it carries no course code and
 * no docente, which is why `parseAtestadoTurmas` is preferred. It stays because
 * it reads a page every session already fetches, so it still works when the
 * atestado postback doesn't.
 */
export function parseTurmasHorario(html: string): TurmaPortal[] {
  const $ = cheerio.load(html);
  const turmas: TurmaPortal[] = [];

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

    // The course name lives inside an <a> (a JSF postback link wrapped in
    // its own <form>) on the real portal markup. A bare <span> is kept as a
    // defensive fallback in case some other row shape doesn't wrap it in a
    // link, and the cell's own text is the last resort.
    const componenteLink = descricaoCell.find('a').first();
    const componenteSpan = descricaoCell.find('span').first();
    const componente = (
      componenteLink.length > 0
        ? componenteLink.text()
        : componenteSpan.length > 0
          ? componenteSpan.text()
          : descricaoCell.text()
    ).trim();
    const local = $(infoCells[0]).text().trim();
    const scheduleText = $(infoCells[1]).text().trim();

    const match = SCHEDULE_CELL_PATTERN.exec(scheduleText);
    if (!match) {
      return;
    }
    const [, codesText, inicio, fim] = match;
    const { codigo, nome } = splitCodigoNome(componente);

    turmas.push({
      codigo,
      nome,
      docente: null,
      // Este parser (Minhas Turmas) é só diagnóstico e nunca fonte de
      // horário (ver o comentário de TurmaPortal em parsers/turma.ts) —
      // parseTurmaVirtualTokens é quem lê o token dessa mesma home.
      frontEndIdTurma: null,
      idTurmaSigaa: null,
      slots: buildTurmaSlots(codesText, local),
      vigencia: { inicio, fim },
      semestre: currentSemester,
    });
  });

  return turmas;
}
