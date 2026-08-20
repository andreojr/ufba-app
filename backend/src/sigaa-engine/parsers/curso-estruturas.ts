import * as cheerio from 'cheerio';

export interface CursoEstrutura {
  codigo: string;
  ativa: boolean;
  jsfParams: Record<string, string>;
  /**
   * The enclosing `<form>`'s own hidden inputs (e.g. `formCurriculosCurso`,
   * `nivel`), excluding `javax.faces.ViewState` (CurriculoPublicSession
   * already manages that one). A real browser submits these alongside
   * `jsfParams` when it clicks "Visualizar Estrutura Curricular" — without
   * them, in particular without the form-marker field
   * (`formCurriculosCurso=formCurriculosCurso`), JSF has no way to tell the
   * form was actually submitted, so the ajax action never fires server-side.
   */
  formFields: Record<string, string>;
}

// "Detalhes da Estrutura Curricular G20251, Criado em  2025"
const CODIGO_PATTERN = /Estrutura Curricular\s+(\S+),/;
// Every key:value pair inside the onclick's jsfcljs({...}) object literal —
// this deliberately does not hardcode the JSF-generated field name, since
// only the shape (two string keys, one of which is "id") is guaranteed.
const JSF_PARAM_PATTERN = /'([^']+)':'([^']+)'/g;
const VIEW_STATE_FIELD = 'javax.faces.ViewState';

/**
 * curriculo.jsf lists every curriculum structure of a course — active and
 * retired — as rows in `table#table_lt`. The "Visualizar Estrutura
 * Curricular" link is a JSF ajax postback (jsfcljs), not a plain href: its
 * onclick attribute carries the exact form fields curso-estruturas' caller
 * must POST back to reach the matrix (see estrutura-resumo.ts). But that
 * onclick only carries the ajax action's own params — a real browser also
 * submits the enclosing form's own hidden inputs, captured separately below
 * as `formFields`.
 */
export function parseCursoEstruturas(html: string): CursoEstrutura[] {
  const $ = cheerio.load(html);
  const estruturas: CursoEstrutura[] = [];

  const formFields: Record<string, string> = {};
  $('form input[type="hidden"]').each((_, input) => {
    const name = $(input).attr('name');
    const value = $(input).attr('value');
    if (name && value !== undefined && name !== VIEW_STATE_FIELD) {
      formFields[name] = value;
    }
  });

  $('table#table_lt tr.linha_par, table#table_lt tr.linha_impar').each(
    (_, row) => {
      const $row = $(row);
      const cells = $row.find('td');
      if (cells.length < 3) {
        return;
      }

      const codigoMatch = $(cells[0]).text().match(CODIGO_PATTERN);
      if (!codigoMatch) {
        return;
      }
      const codigo = codigoMatch[1];
      const status = $(cells[1]).text().trim();

      const onclick =
        $(cells[2])
          .find('a[title="Visualizar Estrutura Curricular"]')
          .attr('onclick') ?? '';
      const jsfParams: Record<string, string> = {};
      for (const match of onclick.matchAll(JSF_PARAM_PATTERN)) {
        jsfParams[match[1]] = match[2];
      }
      if (Object.keys(jsfParams).length === 0) {
        return;
      }

      estruturas.push({
        codigo,
        ativa: status === 'Ativa',
        jsfParams,
        formFields,
      });
    },
  );

  return estruturas;
}
