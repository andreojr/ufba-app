import * as cheerio from 'cheerio';
import { assertPaginaDaTurmaVirtual } from './ava-page';

export interface Avaliacao {
  descricao: string;
  data: string;
}

/**
 * Parses `DataAvaliacao/listar.jsf`'s `table.listing`. Mesma disciplina de
 * noticias.ts: valida a identidade da página antes de concluir "vazio", e não
 * exige o `tbody` que o cheerio não insere sozinho.
 */
export function parseAvaliacoes(html: string): Avaliacao[] {
  assertPaginaDaTurmaVirtual(html, 'a lista de avaliações');
  const $ = cheerio.load(html);
  const avaliacoes: Avaliacao[] = [];

  $('table.listing tr').each((_, row) => {
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
