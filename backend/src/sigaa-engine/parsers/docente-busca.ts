import * as cheerio from 'cheerio';

export interface DocenteBuscaResultado {
  siape: string;
  nome: string;
  departamento: string | null;
}

/**
 * Zero results and a rejected query are different facts, and the caller treats
 * them differently: an empty list is grounds for recording "this docente has no
 * public record" for a month, an error never is.
 */
export type DocenteBuscaResposta =
  | { tipo: 'resultados'; docentes: DocenteBuscaResultado[] }
  | { tipo: 'erro'; mensagem: string };

const SIAPE_PATTERN = /siape=(\d+)/;

/**
 * SIGAA renders "no docentes matched" inside the SAME `#painel-erros` /
 * `ul.erros` block it uses for a rejected query — the DOM cannot tell the two
 * apart, only the message can (verified against both captured fixtures).
 *
 * Getting this backwards is not cosmetic. A zero-result misread as an error is
 * never recorded as a lookup miss, so a docente with no public record gets
 * re-searched on every single screen open, forever.
 */
const SEM_RESULTADOS_PATTERN = /nenhum docente foi encontrado/i;

export function parseDocenteBusca(html: string): DocenteBuscaResposta {
  const $ = cheerio.load(html);

  const aviso = $('#painel-erros .erros li, ul.erros li, .erros li').first().text().trim();
  if (aviso && !SEM_RESULTADOS_PATTERN.test(aviso)) {
    return { tipo: 'erro', mensagem: aviso };
  }

  // Each docente is listed once per lotação, so the same siape recurs across
  // rows with otherwise-identical name but a different departamento. Keyed by
  // siape; later rows overwrite earlier ones so the last-listed lotação wins
  // (confirmed against the captured fixture, where the first row carries the
  // broader "instituto" and the second the specific "departamento").
  const porSiape = new Map<string, DocenteBuscaResultado>();

  $('table.listagem tr').each((_, row) => {
    const $row = $(row);
    const href = $row.find('span.pagina a').attr('href') ?? '';
    const siape = href.match(SIAPE_PATTERN)?.[1];
    if (!siape) {
      return;
    }
    const nome = $row.find('span.nome').text().trim();
    if (!nome) {
      return;
    }
    const departamento = $row.find('span.departamento').text().trim();
    porSiape.set(siape, { siape, nome, departamento: departamento || null });
  });

  return { tipo: 'resultados', docentes: [...porSiape.values()] };
}
