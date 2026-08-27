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
  it('lists data, hora and descrição for each avaliação', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: 'Prova 1', data: '06/10/2026', hora: '16:40' },
      { descricao: 'Prova 2', data: '17/11/2026', hora: '08:00' },
    ]);
  });

  // Regressão do bug real: a ordem das colunas é Data, Hora, Descrição. Ler
  // cells[0] como descrição devolvia "22/09/2026" no título do ponto de
  // atenção e "16h40" como data, que virava Invalid Date no repositório.
  it('does not mistake the data column for the descrição', () => {
    const html = `${MENU}<table class="listing"><tr><th>Data</th><th>Hora</th><th>Descrição</th></tr><tr><td>22/09/2026</td><td>16h40</td><td>1ª Avaliação</td></tr></table>`;

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: '1ª Avaliação', data: '22/09/2026', hora: '16:40' },
    ]);
  });

  // O SIGAA escreve a hora como "16h40"; o contrato de PontoAtencao (e o
  // @Matches do DTO) exige HH:MM.
  it('normalizes the SIGAA "16h40" hour format to HH:MM', () => {
    const html = `${MENU}<table class="listing"><tr><td>22/09/2026</td><td>8h05</td><td>Prova</td></tr></table>`;

    expect(parseAvaliacoes(html)[0].hora).toBe('08:05');
  });

  it('returns hora as null when the cell is empty', () => {
    const html = `${MENU}<table class="listing"><tr><td>22/09/2026</td><td></td><td>Prova</td></tr></table>`;

    expect(parseAvaliacoes(html)[0].hora).toBeNull();
  });

  it('returns an empty list when the turma has no avaliações cadastradas', () => {
    const html = readFileSync(FIXTURE_VAZIO_PATH, 'utf-8');

    expect(parseAvaliacoes(html)).toEqual([]);
  });

  it('parses rows even when the real markup omits <tbody>', () => {
    const html = `${MENU}<table class="listing"><tr><th>Data</th><th>Hora</th><th>Descrição</th></tr><tr><td>06/10/2026</td><td>16h40</td><td>Prova 1</td></tr></table>`;

    expect(parseAvaliacoes(html)).toEqual([
      { descricao: 'Prova 1', data: '06/10/2026', hora: '16:40' },
    ]);
  });

  it('throws when the page is not a Turma Virtual page at all', () => {
    expect(() =>
      parseAvaliacoes('<html><body>home do portal</body></html>'),
    ).toThrow(/formMenu/);
  });
});
