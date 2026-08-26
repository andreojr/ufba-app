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

  it('throws if the expected "Visualização de Notícia" legend is missing (gotcha: GET ?id= renders an empty shell)', () => {
    expect(() => parseNoticiaDetalhe('<html><body>outra página</body></html>')).toThrow(
      /Visualização de Notícia/,
    );
  });
});
