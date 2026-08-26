import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNoticias } from './noticias';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'noticias-listar.html');
const FIXTURE_VAZIO_PATH = join(
  __dirname,
  '__fixtures__',
  'noticias-listar-vazio.html',
);

const MENU = '<form id="formMenu" action="/sigaa/ava/index.jsf"></form>';

describe('parseNoticias', () => {
  it('lists id, título and data for each notícia', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseNoticias(html)).toEqual([
      { id: '6279402', titulo: 'Início do Semestre', data: '18/08/2026' },
    ]);
  });

  it('returns an empty list when the turma simply has no notícias yet', () => {
    const html = readFileSync(FIXTURE_VAZIO_PATH, 'utf-8');

    expect(parseNoticias(html)).toEqual([]);
  });

  // cheerio/htmlparser2 não insere <tbody> como o browser: um SIGAA que
  // omitisse o tbody devolveria [] silenciosamente com o seletor antigo.
  it('parses rows even when the real markup omits <tbody>', () => {
    const html = `${MENU}<table class="listing"><tr><th>Título</th><th>Data</th><th></th></tr><tr><td>Aviso</td><td>19/08/2026</td><td class="icon"><a onclick="jsfcljs(x,{'id':'42'},'')"></a></td></tr></table>`;

    expect(parseNoticias(html)).toEqual([
      { id: '42', titulo: 'Aviso', data: '19/08/2026' },
    ]);
  });

  it('throws when the page is not a Turma Virtual page at all', () => {
    expect(() =>
      parseNoticias('<html><body>home do portal</body></html>'),
    ).toThrow(/formMenu/);
  });
});
