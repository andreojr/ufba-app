import * as cheerio from 'cheerio';

/**
 * Student data shown in the "#agenda-docente" box of the portal discente home
 * (same UFRN-family markup across SIGAA instances: label/value table rows).
 * Every field is nullable — this block is a bonus capture on top of the
 * schedule fetch, so a layout drift must degrade to nulls, never to an error.
 */
export interface DiscentePerfil {
  matricula: string | null;
  curso: string | null;
  periodoIngresso: string | null;
}

const PERIODO_PATTERN = /^\d{4}\.\d$/;

// The entry-period label varies across SIGAA instances ("Entrada", "Período
// de Ingresso", ...), so match on the stems instead of an exact label.
const INGRESSO_LABEL_PATTERN = /\bentrada\b|ingresso/;

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

export function parseDiscentePerfil(html: string): DiscentePerfil {
  const $ = cheerio.load(html);
  const perfil: DiscentePerfil = {
    matricula: null,
    curso: null,
    periodoIngresso: null,
  };

  $('#agenda-docente tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }
    const label = normalizeLabel($(cells[0]).text());
    const value = $(cells[1]).text().trim();
    if (!value) {
      return;
    }

    if (label === 'matricula') {
      perfil.matricula = value;
    } else if (label === 'curso') {
      perfil.curso = value;
    } else if (INGRESSO_LABEL_PATTERN.test(label)) {
      perfil.periodoIngresso = PERIODO_PATTERN.test(value) ? value : null;
    }
  });

  return perfil;
}
