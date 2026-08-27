import * as cheerio from 'cheerio';
import { assertPaginaDaTurmaVirtual } from './ava-page';

export interface Avaliacao {
  descricao: string;
  data: string;
  /** HH:MM, ou null quando o professor não marcou horário. */
  hora: string | null;
}

/**
 * O SIGAA escreve a hora como "16h40" (e "8h05" sem zero à esquerda); o
 * contrato de PontoAtencao — e o `@Matches(/^\d{2}:\d{2}$/)` do DTO — exige
 * HH:MM. Uma célula vazia ou num formato que não reconhecemos vira null, que
 * já é um valor válido pro campo, em vez de propagar lixo.
 */
function paraHoraHhMm(texto: string): string | null {
  const match = /^(\d{1,2})h(\d{2})$/.exec(texto);
  if (!match) {
    return null;
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/**
 * Parses `DataAvaliacao/listar.jsf`'s `table.listing`. Mesma disciplina de
 * noticias.ts: valida a identidade da página antes de concluir "vazio", e não
 * exige o `tbody` que o cheerio não insere sozinho.
 *
 * A ordem das colunas é **Data, Hora, Descrição** (mais uma quarta de ações,
 * vazia pro aluno) — confirmado contra sigaa.ufba.br em 27/08/2026. Antes este
 * parser supunha "Descrição, Data", o que devolvia a data como título do ponto
 * de atenção e a hora como data: `paraDataBr("16h40")` virava Invalid Date e
 * estourava um RangeError, engolido pelo try/catch do controller — as
 * avaliações simplesmente nunca chegavam nos Pontos de Atenção.
 */
export function parseAvaliacoes(html: string): Avaliacao[] {
  assertPaginaDaTurmaVirtual(html, 'a lista de avaliações');
  const $ = cheerio.load(html);
  const avaliacoes: Avaliacao[] = [];

  $('table.listing tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) {
      return;
    }
    const data = $(cells[0]).text().trim();
    const descricao = $(cells[2]).text().trim();
    // Uma linha sem data ou sem descrição não descreve uma avaliação — omitir
    // é melhor que criar um ponto de atenção sem título ou com data inválida.
    if (!data || !descricao) {
      return;
    }
    avaliacoes.push({
      descricao,
      data,
      hora: paraHoraHhMm($(cells[1]).text().trim()),
    });
  });

  return avaliacoes;
}
