/**
 * The classic portal discente triggers document actions ("Emitir Histórico",
 * "Emitir Atestado de Matrícula", ...) through a JSCookMenu: clicking an item
 * fills the menu form's hidden `jscook_action` input with that item's action
 * token and submits the form back to discente.jsf. Both the hidden `id` and the
 * action token vary per SIGAA instance/deploy (the menu id embeds a generated
 * JSP id, e.g. `menu_form_menu_discente_j_id_jsp_440181972_4_menu` at UFC,
 * `..._315194548_99_menu` at UFBA), so they must be scraped from the rendered
 * page rather than hardcoded.
 */
export interface MenuPostback {
  /** Value of the menu form's hidden `id` input (the discente's internal id). */
  id: string;
  /** Full `jscook_action` token for the requested menu item. */
  jscookAction: string;
}

const HIDDEN_ID_PATTERN = /<input type="hidden" name="id" value="(\d+)"\s*\/?>/;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts the postback fields for one JSCookMenu item, keyed by its JSF action
 * expression (e.g. `portalDiscente.historico`). The action token's menu prefix
 * (`menu_form_menu_discente_...`) embeds a per-deploy generated JSP id, so we
 * anchor on the stable expression and capture the whole token rather than
 * assuming a fixed prefix. The `\s*\}` suffix keeps a request for
 * `portalDiscente.historico` from matching the sibling
 * `portalDiscente.historicoComDadosAdicionais` ("Emitir Histórico Completo").
 */
function parseMenuPostback(
  html: string,
  actionExpression: string,
): MenuPostback {
  const idMatch = HIDDEN_ID_PATTERN.exec(html);
  if (!idMatch) {
    throw new Error(
      'Could not find the hidden <input name="id"> of the portal discente menu form',
    );
  }

  const actionPattern = new RegExp(
    `'([^']*menu[^']*:A\\]#\\{\\s*${escapeForRegExp(actionExpression)}\\s*\\})'`,
  );
  const actionMatch = actionPattern.exec(html);
  if (!actionMatch) {
    throw new Error(
      `Could not find the ${actionExpression} jscook_action in the portal discente menu`,
    );
  }

  return { id: idMatch[1], jscookAction: actionMatch[1] };
}

export function parseHistoricoMenuPostback(html: string): MenuPostback {
  return parseMenuPostback(html, 'portalDiscente.historico');
}

export function parseAtestadoMenuPostback(html: string): MenuPostback {
  return parseMenuPostback(html, 'portalDiscente.atestadoMatricula');
}
