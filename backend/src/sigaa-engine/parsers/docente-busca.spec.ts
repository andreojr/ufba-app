import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteBusca } from './docente-busca';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseDocenteBusca', () => {
  it('extracts siape, nome and departamento from the results table', () => {
    const resposta = parseDocenteBusca(
      fixture('docente-busca-duplicatas.html'),
    );
    expect(resposta.tipo).toBe('resultados');
    if (resposta.tipo !== 'resultados') return;

    const apolinario = resposta.docentes.find((d) => d.siape === '1815041');
    expect(apolinario).toEqual({
      siape: '1815041',
      nome: 'ANTONIO LOPES APOLINARIO JUNIOR',
      departamento: 'DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC',
    });
  });

  it('dedupes the per-lotação duplicate rows by siape', () => {
    const resposta = parseDocenteBusca(
      fixture('docente-busca-duplicatas.html'),
    );
    if (resposta.tipo !== 'resultados') throw new Error('expected results');

    const siapes = resposta.docentes.map((d) => d.siape);
    expect(new Set(siapes).size).toBe(siapes.length);
  });

  // SIGAA puts BOTH messages in the same `ul.erros` block, so the DOM cannot
  // separate them — only the text can. Misreading zero-results as an error
  // means no miss is ever recorded and the docente is re-searched forever.
  // Zero results must be asserted POSITIVELY from SIGAA's own message, never
  // inferred from an empty/missing table — see the "unrecognised HTML" test
  // below for why.
  it('reads a genuine zero-result page as sem-resultados, not an error', () => {
    expect(parseDocenteBusca(fixture('docente-busca-vazia.html'))).toEqual({
      tipo: 'sem-resultados',
    });
  });

  it('tells the two ul.erros messages apart, since their markup is identical', () => {
    const vazia = parseDocenteBusca(fixture('docente-busca-vazia.html'));
    const curto = parseDocenteBusca(fixture('docente-busca-erro-curto.html'));
    expect(vazia.tipo).toBe('sem-resultados');
    expect(curto.tipo).toBe('erro');
  });

  it('reads the minimum-length complaint as an error, not as zero results', () => {
    const resposta = parseDocenteBusca(
      fixture('docente-busca-erro-curto.html'),
    );
    expect(resposta.tipo).toBe('erro');
    if (resposta.tipo !== 'erro') return;
    expect(resposta.mensagem).toContain('4 caracteres');
  });

  // The whole reason `sem-resultados` must come from an explicit message: a
  // SIGAA maintenance page (or any other unrecognised 200) has neither a
  // results table nor a recognised error/zero-result message. Reading that as
  // "resultados: []" would let an outage write a permanent false miss.
  it('reads unrecognised HTML with no table and no message as an error, never as zero results', () => {
    const resposta = parseDocenteBusca('<html><body>Manutenção</body></html>');
    expect(resposta.tipo).toBe('erro');
  });

  it('prefers the department over the institute regardless of row order', () => {
    const html = `<table class="listagem">
      <tr><td><span class="nome">FULANO DE TAL</span>
        <span class="departamento"> DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC </span>
        <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
      <tr><td><span class="nome">FULANO DE TAL</span>
        <span class="departamento"> INSTITUTO DE COMPUTAÇÃO </span>
        <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
    </table>`;
    const resposta = parseDocenteBusca(html);
    if (resposta.tipo !== 'resultados') throw new Error('expected results');
    expect(resposta.docentes).toHaveLength(1);
    expect(resposta.docentes[0].departamento).toBe(
      'DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC',
    );
  });
});
