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

// SIGAA lists a docente once per lotação, and the lotação can be recorded at
// either of two levels: the broad "instituto" or the specific "departamento".
// A student looking a professor up wants the department — it is the useful,
// specific label, while the institute is just the umbrella above it.
function normalizeForComparison(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function nomeiaDepartamento(departamento: string): boolean {
  return normalizeForComparison(departamento).startsWith('departamento');
}

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

  const aviso = $('#painel-erros .erros li, ul.erros li, .erros li')
    .first()
    .text()
    .trim();
  if (aviso && !SEM_RESULTADOS_PATTERN.test(aviso)) {
    return { tipo: 'erro', mensagem: aviso };
  }

  // Each docente is listed once per lotação, so the same siape recurs across
  // rows with an otherwise-identical name but a different departamento value.
  // The first row seen sets siape/nome and is kept as-is; departamento is the
  // only field that can later be upgraded, and only from institute to
  // department, never the reverse — this deliberately does NOT depend on row
  // order (SIGAA is free to emit the rows in either order and the result must
  // not change; see the "regardless of row order" test).
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
    const departamento = $row.find('span.departamento').text().trim() || null;

    const existente = porSiape.get(siape);
    if (!existente) {
      porSiape.set(siape, { siape, nome, departamento });
      return;
    }
    // A student wants the department, not the institute umbrella above it:
    // upgrade only when the incoming value names a department and the one
    // already stored does not.
    if (
      departamento &&
      nomeiaDepartamento(departamento) &&
      !(existente.departamento && nomeiaDepartamento(existente.departamento))
    ) {
      existente.departamento = departamento;
    }
  });

  return { tipo: 'resultados', docentes: [...porSiape.values()] };
}
