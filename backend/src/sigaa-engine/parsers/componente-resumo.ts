import * as cheerio from 'cheerio';

export interface ComponenteResumoDetalhe {
  unidadeResponsavel: string | null;
  preRequisito: string | null;
  coRequisito: string | null;
  equivalencias: string | null;
}

/**
 * What the page itself says it is describing, alongside the detail fields.
 * Deliberately NOT part of `ComponenteResumoDetalhe` (the shape that gets
 * persisted, where the código already comes from the matrix row): this is a
 * verification field, read back so a caller can tell a response describing
 * the *wrong* component apart from the one it asked for.
 */
export interface ComponenteResumoPagina extends ComponenteResumoDetalhe {
  codigo: string | null;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
}

/**
 * SIGAA prints "-" for an empty pré-requisito/co-requisito/equivalências —
 * that must not be persisted as the literal string.
 */
function valorOuNulo(texto: string): string | null {
  // Collapse the whitespace/newlines the ACRONYM-wrapped codes are laid out
  // with into single spaces, since the expression's own parentheses and
  // spacing (not the source markup's indentation) are what a reader needs.
  const normalizado = texto.replace(/\s+/g, ' ').trim();
  return normalizado === '' || normalizado === '-' ? null : normalizado;
}

/**
 * table.visualizacao carries the same label/value th/td shape as
 * estrutura-resumo's table.formulario. Pré-requisito/equivalências wrap each
 * referenced código in an <ACRONYM> tag, but .text() already flattens that —
 * no special-casing needed beyond the "-" → null rule.
 */
export function parseComponenteResumo(html: string): ComponenteResumoPagina {
  const $ = cheerio.load(html);
  const detalhe: ComponenteResumoPagina = {
    codigo: null,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };

  $('table.visualizacao tr').each((_, row) => {
    const $row = $(row);
    // `children`, not `find`: the page nests a whole "Currículos" table
    // inside one of this table's own rows, and that nested table's header
    // carries its own `<th>Código</th>` — a deep search reads that as this
    // row's label and hands back the entire nested table as its value.
    const th = $row.children('th').first();
    const td = $row.children('td').first();
    if (!th.length || !td.length) {
      return;
    }
    const label = normalizeLabel(th.text());
    const valor = valorOuNulo(td.text());

    if (label === 'codigo') {
      detalhe.codigo = valor;
    } else if (label === 'unidade responsavel') {
      detalhe.unidadeResponsavel = valor;
    } else if (label === 'pre-requisitos') {
      detalhe.preRequisito = valor;
    } else if (label === 'co-requisitos') {
      detalhe.coRequisito = valor;
    } else if (label === 'equivalencias') {
      detalhe.equivalencias = valor;
    }
  });

  return detalhe;
}
