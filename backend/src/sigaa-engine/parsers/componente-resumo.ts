import * as cheerio from 'cheerio';

export interface ComponenteResumoDetalhe {
  unidadeResponsavel: string | null;
  preRequisito: string | null;
  coRequisito: string | null;
  equivalencias: string | null;
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
export function parseComponenteResumo(html: string): ComponenteResumoDetalhe {
  const $ = cheerio.load(html);
  const detalhe: ComponenteResumoDetalhe = {
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };

  $('table.visualizacao tr').each((_, row) => {
    const $row = $(row);
    const th = $row.find('th').first();
    const td = $row.find('td').first();
    if (!th.length || !td.length) {
      return;
    }
    const label = normalizeLabel(th.text());
    const valor = valorOuNulo(td.text());

    if (label === 'unidade responsavel') {
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
