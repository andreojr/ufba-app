import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNoticias } from './noticias';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'noticias-listar.html');

describe('parseNoticias', () => {
  it('lists id, título and data for each notícia', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseNoticias(html)).toEqual([
      { id: '6279402', titulo: 'Início do Semestre', data: '18/08/2026' },
    ]);
  });

  it('returns an empty list when there is no listing table', () => {
    expect(parseNoticias('<html><body>sem notícias</body></html>')).toEqual([]);
  });
});
