import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNoticiaDetalhe } from './noticia-detalhe';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'noticia-mostrar.html');

describe('parseNoticiaDetalhe', () => {
  it('parses título, data, autor and the rich HTML body', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseNoticiaDetalhe(html)).toEqual({
      titulo: 'Início do Semestre',
      data: '18/08/2026 13:44',
      autor: 'NOME DO DOCENTE',
      conteudoHtml:
        '<p>Boa tarde, turma. <strong>Sejam bem-vindos</strong>.</p>',
    });
  });

  it('throws if the expected "Visualização de Notícia" legend is missing', () => {
    expect(() => parseNoticiaDetalhe('<html><body>outra página</body></html>')).toThrow(
      /Visualização de Notícia/,
    );
  });

  // Gotcha 2 da investigação: a casca vazia TEM a legenda e os <label>s — só
  // título, data e texto vêm em branco. A legenda sozinha não detecta nada.
  it('throws on the empty shell, which carries the legend but blank título/texto', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__', 'noticia-mostrar-casca-vazia.html'),
      'utf-8',
    );

    expect(() => parseNoticiaDetalhe(html)).toThrow(/casca vazia/);
  });
});
