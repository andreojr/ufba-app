import * as cheerio from 'cheerio';

export interface PostbackAcessarTurma {
  fields: Record<string, string>;
}

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
    const value = $form.find('input[name="frontEndIdTurma"]').attr('value');
    if (value !== frontEndIdTurma) {
      return;
    }
    const fields: Record<string, string> = {};
    $form.find('input[type="hidden"]').each((_, input) => {
      const $input = $(input);
      const name = $input.attr('name');
      const inputValue = $input.attr('value');
      if (name && inputValue !== undefined) {
        fields[name] = inputValue;
      }
    });
    found = fields;
  });

  if (!found) {
    throw new Error(
      `Nenhum form_acessarTurmaVirtual encontrado para frontEndIdTurma=${frontEndIdTurma}`,
    );
  }

  return { fields: found };
}
