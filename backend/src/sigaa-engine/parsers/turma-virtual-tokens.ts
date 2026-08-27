import * as cheerio from 'cheerio';

// Every key:value pair inside the "acessar Turma Virtual" link's onclick
// jsfcljs({...}) object literal — same generic capture used by
// estrutura-resumo.ts's JSF_PARAM_PATTERN. Real SIGAA markup never renders
// frontEndIdTurma as an <input>: it only ever travels as one of these
// partial-submit params (confirmed against sigaa.ufba.br — see
// TURMA_VIRTUAL_INVESTIGATION.md).
const JSF_PARAM_PATTERN = /'([^']+)':'([^']+)'/g;

export interface TurmaVirtualToken {
  /**
   * O texto do link, ex. "PROJETO DE CIRCUITOS INTEGRADOS DIGITAIS" — nunca
   * "CÓDIGO - Nome" como se esperava antes (a home real do SIGAA da UFBA não
   * inclui o código do componente aqui, só o nome, confirmado contra
   * sigaa.ufba.br). É a chave de junção com o `nome` do `Turma[]` construído
   * pelo atestado de matrícula, não o código.
   */
  nome: string;
  frontEndIdTurma: string;
  idTurmaSigaa: string | null;
}

/**
 * Lê a home do portal em busca do `form_acessarTurmaVirtualN` de cada turma —
 * o único documento que carrega `frontEndIdTurma` (ver
 * TURMA_VIRTUAL_INVESTIGATION.md). Uma turma sem esse form (professor não
 * habilitou a Turma Virtual) é omitida do resultado, não é um erro.
 */
export function parseTurmaVirtualTokens(html: string): TurmaVirtualToken[] {
  const $ = cheerio.load(html);
  const tokens: TurmaVirtualToken[] = [];

  $('form[id^="form_acessarTurmaVirtual"]').each((_, form) => {
    const $form = $(form);
    const $link = $form.find('a').first();
    const onclick = $link.attr('onclick') ?? '';
    const jsfParams: Record<string, string> = {};
    for (const match of onclick.matchAll(JSF_PARAM_PATTERN)) {
      jsfParams[match[1]] = match[2];
    }

    const frontEndIdTurma =
      $form.find('input[name="frontEndIdTurma"]').attr('value') ??
      jsfParams['frontEndIdTurma'];
    if (!frontEndIdTurma) {
      return;
    }
    const idTurmaSigaa =
      $form.find('input[name="idTurma"]').attr('value') ??
      jsfParams['idTurma'] ??
      null;
    const nome = $link.text().trim();

    tokens.push({ nome, frontEndIdTurma, idTurmaSigaa });
  });

  return tokens;
}
