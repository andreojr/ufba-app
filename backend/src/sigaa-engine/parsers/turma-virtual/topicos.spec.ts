import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTopicos } from './topicos';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'timeline.html');

describe('parseTopicos', () => {
  it('parses título, período and conteudoHtml, with null for an empty conteúdo', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseTopicos(html)).toEqual([
      { titulo: 'Aula 1', periodo: '20/08/2026 - 20/08/2026', conteudoHtml: null },
      {
        titulo: 'Aula 2',
        periodo: '25/08/2026 - 25/08/2026',
        conteudoHtml: '<p>Slides da aula 2 anexados.</p>',
      },
    ]);
  });
});
