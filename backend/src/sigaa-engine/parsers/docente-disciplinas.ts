import * as cheerio from 'cheerio';

/**
 * "Disciplinas Ministradas" (`/sigaa/public/docente/disciplinas.jsf?siape=…`):
 * one `table.listagem` per aba (graduação, pós, técnico, ...) where a
 * full-width `td.anoPeriodo` row opens each term and the course rows follow
 * it, newest term first.
 */
export interface DocenteDisciplina {
  semestre: string;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Verbatim, e.g. "24T34 (19/08/2026 - 19/12/2026)" — see schedule-code.ts. */
  horario: string;
}

const SEMESTRE_PATTERN = /^\d{4}\.\d$/;

export function parseDocenteDisciplinas(html: string): DocenteDisciplina[] {
  const $ = cheerio.load(html);
  const disciplinas: DocenteDisciplina[] = [];
  let semestre: string | null = null;

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);

    const cabecalho = $row.find('td.anoPeriodo').first().text().trim();
    if (SEMESTRE_PATTERN.test(cabecalho)) {
      semestre = cabecalho;
      return;
    }

    const codigoCelula = $row.find('td.codigo').first();
    const codigo = codigoCelula.text().trim();
    if (!semestre || !codigo) {
      return;
    }

    const cargaHoraria = Number.parseInt(
      $row.find('td.ch').first().text().replace(/\D/g, ''),
      10,
    );

    disciplinas.push({
      semestre,
      codigo,
      nome: codigoCelula.next().text().trim(),
      cargaHoraria: Number.isNaN(cargaHoraria) ? 0 : cargaHoraria,
      horario: $row.find('td.horario').first().text().trim(),
    });
  });

  return disciplinas;
}
