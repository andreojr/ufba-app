import * as cheerio from 'cheerio';
import { assertPaginaDaTurmaVirtual } from './ava-page';

export interface NoticiaResumo {
  id: string;
  titulo: string;
  data: string;
}

const ID_PATTERN = /'id'\s*:\s*'(\d+)'/;

/**
 * Parses `NoticiaTurma/listar.jsf`'s `table.listing`. Uma lista vazia com o
 * marcador de identidade presente é resposta válida ("nada postado ainda"); a
 * ausência do marcador é erro (ver ava-page.ts).
 *
 * O seletor não passa por `tbody` de propósito: cheerio/htmlparser2 não
 * insere o elemento implícito como o browser faz, então exigi-lo devolveria
 * `[]` num SIGAA que o omitisse. A linha de cabeçalho não atrapalha — seus
 * `<th>` não casam com `td`, e a guarda de contagem de células a descarta.
 */
export function parseNoticias(html: string): NoticiaResumo[] {
  assertPaginaDaTurmaVirtual(html, 'a lista de notícias');
  const $ = cheerio.load(html);
  const noticias: NoticiaResumo[] = [];

  $('table.listing tr').each((_, row) => {
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
