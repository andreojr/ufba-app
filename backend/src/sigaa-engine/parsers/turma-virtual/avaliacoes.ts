import * as cheerio from 'cheerio';

export interface Avaliacao {
  descricao: string;
  data: string;
}

/** Parses `DataAvaliacao/listar.jsf`'s `table.listing`. */
export function parseAvaliacoes(html: string): Avaliacao[] {
  const $ = cheerio.load(html);
  const avaliacoes: Avaliacao[] = [];

  $('table.listing tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }
    avaliacoes.push({
      descricao: $(cells[0]).text().trim(),
      data: $(cells[1]).text().trim(),
    });
  });

  return avaliacoes;
}
