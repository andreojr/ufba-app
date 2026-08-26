import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAvaliacoes } from './avaliacoes';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'avaliacoes-listar.html');
const FIXTURE_VAZIO_PATH = join(
  __dirname,
  '__fixtures__',
  'avaliacoes-listar-vazio.html',
);

const MENU = '<form id="formMenu" action="/sigaa/ava/index.jsf"></form>';

describe('parseAvaliacoes', () => {
  it('lists descrição and data for each avaliação', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: 'Prova 1', data: '06/10/2026' },
      { descricao: 'Prova 2', data: '17/11/2026' },
    ]);
  });

  it('returns an empty list when the turma has no avaliações cadastradas', () => {
    const html = readFileSync(FIXTURE_VAZIO_PATH, 'utf-8');

    expect(parseAvaliacoes(html)).toEqual([]);
  });

  it('parses rows even when the real markup omits <tbody>', () => {
    const html = `${MENU}<table class="listing"><tr><th>Descrição</th><th>Data</th></tr><tr><td>Prova 1</td><td>06/10/2026</td></tr></table>`;

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: 'Prova 1', data: '06/10/2026' },
    ]);
  });

  it('throws when the page is not a Turma Virtual page at all', () => {
    expect(() =>
      parseAvaliacoes('<html><body>home do portal</body></html>'),
    ).toThrow(/formMenu/);
  });
});
