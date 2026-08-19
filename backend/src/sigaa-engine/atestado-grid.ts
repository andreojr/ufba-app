/**
 * The atestado's "Tabela de Horários" is a grid whose every cell ships as
 * `<span id="<day>_<slot>">---</span>`. A script at the end of the page then
 * fills the occupied cells with their course code, one assignment each:
 *
 *     var elem = document.getElementById('2_15');
 *     if (elem) elem.innerHTML = 'ENGG54';
 *
 * Because the whole document is rendered to a PDF with scripts stripped, that
 * script never runs and the grid would stay all "---". This applies those exact
 * assignments to the spans server-side, so the printed grid matches SIGAA's.
 * The lookup is the assignment list itself — no need to re-derive it from each
 * turma's horário code.
 */

// getElementById('<id>'); if (elem) elem.innerHTML = '<code>' — the precise
// shape of a grid fill, which also excludes any other getElementById use.
const FILL_ASSIGNMENT =
  /getElementById\('([^']+)'\)\s*;\s*if\s*\(\s*elem\s*\)\s*elem\.innerHTML\s*=\s*'([^']*)'/g;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function fillScheduleGrid(html: string): string {
  let out = html;
  for (const [, id, code] of html.matchAll(FILL_ASSIGNMENT)) {
    const span = new RegExp(
      `(<span id="${escapeForRegExp(id)}">)[^<]*(</span>)`,
    );
    out = out.replace(
      span,
      (_full, open: string, close: string) => open + code + close,
    );
  }
  return out;
}
