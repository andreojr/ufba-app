import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAvaliacoes } from './avaliacoes';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'avaliacoes-listar.html');

describe('parseAvaliacoes', () => {
  it('lists descrição and data for each avaliação', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: 'Prova 1', data: '06/10/2026' },
      { descricao: 'Prova 2', data: '17/11/2026' },
    ]);
  });

  it('returns an empty list when the turma has no avaliações cadastradas', () => {
    expect(parseAvaliacoes('<html><body>nada</body></html>')).toEqual([]);
  });
});
