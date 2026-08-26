import * as cheerio from 'cheerio';

export interface NoticiaResumo {
  id: string;
  titulo: string;
  data: string;
}

const ID_PATTERN = /'id'\s*:\s*'(\d+)'/;

/** Parses `NoticiaTurma/listar.jsf`'s `table.listing`. */
export function parseNoticias(html: string): NoticiaResumo[] {
  const $ = cheerio.load(html);
  const noticias: NoticiaResumo[] = [];

  $('table.listing tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) {
      return;
    }
    const onclick = $(cells[2]).find('a').attr('onclick') ?? '';
    const match = ID_PATTERN.exec(onclick);
    if (!match) {
      return;
    }
    noticias.push({
      id: match[1],
      titulo: $(cells[0]).text().trim(),
      data: $(cells[1]).text().trim(),
    });
  });

  return noticias;
}
