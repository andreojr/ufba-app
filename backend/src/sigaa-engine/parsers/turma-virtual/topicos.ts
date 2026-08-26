import * as cheerio from 'cheerio';

export interface Topico {
  titulo: string;
  periodo: string;
  conteudoHtml: string | null;
}

const TITULO_PATTERN = /^(.+?)\s*\(([\s\S]+)\)$/;

/**
 * Parses `Relatorios/timeline.jsf`'s `div.topico-aula`. `conteudoHtml` vem
 * `null` quando o professor cadastrou a data mas nunca postou material — caso
 * comum hoje (ver "Estado do conteúdo hoje" na investigação).
 */
export function parseTopicos(html: string): Topico[] {
  const $ = cheerio.load(html);
  const topicos: Topico[] = [];

  $('div.topico-aula').each((_, el) => {
    const tituloBruto = $(el).find('div.titulo').text().trim();
    const match = TITULO_PATTERN.exec(tituloBruto);
    if (!match) {
      return;
    }
    const conteudo = ($(el).find('div.conteudotopico').html() ?? '').trim();
    topicos.push({
      titulo: match[1].trim(),
      periodo: match[2].trim(),
      conteudoHtml: conteudo || null,
    });
  });

  return topicos;
}
