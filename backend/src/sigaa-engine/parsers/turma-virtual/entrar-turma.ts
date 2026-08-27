import * as cheerio from 'cheerio';

export interface PostbackAcessarTurma {
  fields: Record<string, string>;
}

// Every key:value pair inside the "acessar Turma Virtual" link's onclick
// jsfcljs({...}) object literal — same generic capture as
// turma-virtual-tokens.ts's JSF_PARAM_PATTERN and estrutura-resumo.ts's. Real
// SIGAA markup carries frontEndIdTurma (and the form's own partial-submit
// trigger key) only here, never as an <input> — a real browser submits both
// the form's hidden inputs AND these params together.
const JSF_PARAM_PATTERN = /'([^']+)':'([^']+)'/g;

/**
 * Monta os campos de POST pra entrar na Turma Virtual daquela turma, a partir
 * da home do portal recém-lida. O nome dos campos hidden (`j_id_jsp_*`) varia
 * por deploy do SIGAA — nunca hardcodar, sempre ler do form correspondente
 * (mesma disciplina de parsers/portal-menu.ts).
 */
export function parsePostbackAcessarTurma(
  portalHtml: string,
  frontEndIdTurma: string,
): PostbackAcessarTurma {
  const $ = cheerio.load(portalHtml);

  let found: Record<string, string> | null = null;
  $('form[id^="form_acessarTurmaVirtual"]').each((_, form) => {
    if (found) {
      return;
    }
    const $form = $(form);
    const fields: Record<string, string> = {};
    $form.find('input[type="hidden"]').each((_, input) => {
      const $input = $(input);
      const name = $input.attr('name');
      const inputValue = $input.attr('value');
      if (name && inputValue !== undefined) {
        fields[name] = inputValue;
      }
    });
    const onclick = $form.find('a').first().attr('onclick') ?? '';
    for (const match of onclick.matchAll(JSF_PARAM_PATTERN)) {
      fields[match[1]] = match[2];
    }

    if (fields['frontEndIdTurma'] !== frontEndIdTurma) {
      return;
    }
    found = fields;
  });

  if (!found) {
    throw new Error(
      `Nenhum form_acessarTurmaVirtual encontrado para frontEndIdTurma=${frontEndIdTurma}`,
    );
  }

  return { fields: found };
}
