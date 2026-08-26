import * as cheerio from 'cheerio';

export interface NoticiaDetalhe {
  titulo: string;
  data: string;
  autor: string | null;
  conteudoHtml: string;
}

function textAfterLabel($: cheerio.CheerioAPI, li: cheerio.Element, label: string): string {
  const $li = $(li);
  if (!$li.find('label').text().trim().startsWith(label)) {
    return '';
  }
  const clone = $li.clone();
  clone.find('label').remove();
  return clone.text().trim();
}

/**
 * Parses `NoticiaTurma/mostrar.jsf`. Só é confiável quando `id` chegou como
 * campo de POST — via GET na query, o SIGAA devolve a mesma legenda com
 * título/data/texto em branco (gotcha confirmado no spike), por isso a
 * ausência da legenda vira erro em vez de um objeto parcial silencioso.
 */
export function parseNoticiaDetalhe(html: string): NoticiaDetalhe {
  const $ = cheerio.load(html);
  const legend = $('legend').filter(
    (_, el) => $(el).text().trim() === 'Visualização de Notícia',
  );
  if (legend.length === 0) {
    throw new Error(
      'Página inesperada: legenda "Visualização de Notícia" não encontrada — provável casca vazia (ver noticia-detalhe.ts).',
    );
  }

  let titulo = '';
  let data = '';
  let autor: string | null = null;

  $('ul.form > li').each((_, li) => {
    const label = $(li).find('label').first().text().trim();
    if (label.startsWith('Título')) {
      titulo = textAfterLabel($, li, 'Título');
    } else if (label.startsWith('Data')) {
      data = textAfterLabel($, li, 'Data');
    } else if (label.startsWith('Cadastrado por')) {
      const autorText = textAfterLabel($, li, 'Cadastrado por');
      autor = autorText || null;
    }
  });

  // Extract conteudoHtml from the raw HTML before cheerio parses it.
  // SIGAA nests `<td class="conteudoNoticia">` inside `<li>`, which is invalid HTML.
  // cheerio's htmlparser2 strips the `<td>` tag but hoists its children.
  // So we extract from the raw string using regex, preserving the rich HTML markup.
  let conteudoHtml = '';
  const tdMatch = html.match(/<td\s+class="conteudoNoticia"[^>]*>([\s\S]*?)<\/td>/);
  if (tdMatch) {
    conteudoHtml = tdMatch[1].trim();
  }

  return { titulo, data, autor, conteudoHtml };
}
