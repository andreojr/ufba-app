import * as cheerio from 'cheerio';

const COMPONENTE_CODE_PATTERN = /^([A-Z]{2,4}\d{2,3})\s*-\s*(.+)$/;

export interface TurmaVirtualToken {
  codigo: string | null;
  frontEndIdTurma: string;
  idTurmaSigaa: string | null;
}

function readCodigo(linkText: string): string | null {
  const match = COMPONENTE_CODE_PATTERN.exec(linkText.trim());
  return match ? match[1] : null;
}

/**
 * Lê a home do portal em busca do `form_acessarTurmaVirtualN` de cada turma —
 * o único documento que carrega `frontEndIdTurma` (ver
 * TURMA_VIRTUAL_INVESTIGATION.md). Uma turma sem esse form (professor não
 * habilitou a Turma Virtual) é omitida do resultado, não é um erro.
 *
 * `codigo` é a chave de junção com o `Turma[]` construído pelo atestado de
 * matrícula (parseAtestadoTurmas) — os dois documentos não compartilham mais
 * nada de útil, mas ambos trazem o código do componente.
 */
export function parseTurmaVirtualTokens(html: string): TurmaVirtualToken[] {
  const $ = cheerio.load(html);
  const tokens: TurmaVirtualToken[] = [];

  $('form[id^="form_acessarTurmaVirtual"]').each((_, form) => {
    const $form = $(form);
    const frontEndIdTurma = $form
      .find('input[name="frontEndIdTurma"]')
      .attr('value');
    if (!frontEndIdTurma) {
      return;
    }
    const idTurmaSigaa = $form.find('input[name="idTurma"]').attr('value') ?? null;
    const codigo = readCodigo($form.find('a').first().text());

    tokens.push({ codigo, frontEndIdTurma, idTurmaSigaa });
  });

  return tokens;
}
