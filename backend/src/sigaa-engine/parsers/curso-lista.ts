import * as cheerio from 'cheerio';

export interface CursoListaItem {
  idSigaa: string;
  nome: string;
  sede: string;
  nivel: string;
}

// portal.jsf?id=1876880&lc=pt_BR&nivel=G
const HREF_PATTERN = /[?&]id=(\d+)&lc=[^&]*&nivel=(\w+)/;

/**
 * lista.jsf mixes two row shapes in the same `table.listagem`: a
 * `colspan`-wide header row naming the unidade (e.g. "EPOLI - ESCOLA
 * POLITÉCNICA") and, below it, one two-cell data row per course the unidade
 * offers. Only the second shape carries a course.
 */
export function parseCursoLista(html: string): CursoListaItem[] {
  const $ = cheerio.load(html);
  const cursos: CursoListaItem[] = [];

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);
    const cells = $row.find('td');
    if (cells.length < 2) {
      return;
    }

    const nome = $(cells[0]).text().trim();
    const sede = $(cells[1]).text().trim();
    const href =
      $row.find('a[title="Visualizar Página do Curso"]').attr('href') ?? '';
    const match = href.match(HREF_PATTERN);

    if (!nome || !sede || !match) {
      return;
    }

    cursos.push({ idSigaa: match[1], nome, sede, nivel: match[2] });
  });

  return cursos;
}
