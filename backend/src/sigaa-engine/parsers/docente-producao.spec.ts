import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocenteProducao } from './docente-producao';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'docente-producao.html'),
  'utf-8',
);

describe('parseDocenteProducao', () => {
  it('counts fewer supervisions than the inflated <h2> header claims', () => {
    // Measured on siape 1652496: the header says "(42)" but the same
    // supervision (same name, same start, same state) is listed twice.
    const cabecalho = Number.parseInt(
      /Orienta[^(]*\((\d+)\)/.exec(fixture)?.[1] ?? '0',
      10,
    );
    const { orientacoes } = parseDocenteProducao(fixture);
    const total =
      orientacoes.mestradoAndamento +
      orientacoes.mestradoConcluidas +
      orientacoes.doutoradoAndamento +
      orientacoes.doutoradoConcluidas;

    expect(cabecalho).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(cabecalho);
  });

  it('returns no TCCs for a page that has no Trabalho de Fim de Curso section', () => {
    const { tccsOrientados, orientacoes } = parseDocenteProducao(fixture);
    expect(tccsOrientados).toEqual([]);
    expect(
      orientacoes.mestradoAndamento +
        orientacoes.mestradoConcluidas +
        orientacoes.doutoradoAndamento +
        orientacoes.doutoradoConcluidas,
    ).toBeGreaterThan(0);
  });

  it('never lets a student name escape into the returned data', () => {
    const html = `<h2>Trabalho de Fim de Curso (2)</h2>
      <ul class="listagem">
        <li>Um estudo sobre grafos, MARIA DAS DORES SANTOS, 03/2024</li>
        <li>Outro trabalho, JOAO PEREIRA LIMA, 11/2023</li>
      </ul>`;
    const resultado = parseDocenteProducao(html);

    expect(resultado.tccsOrientados).toHaveLength(2);
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain('MARIA DAS DORES SANTOS');
    expect(serializado).not.toContain('JOAO PEREIRA LIMA');
    for (const tcc of resultado.tccsOrientados) {
      expect(Object.keys(tcc).sort()).toEqual(['ano', 'titulo']);
      expect(Number.isInteger(tcc.ano)).toBe(true);
    }
  });

  it('keeps a comma inside a TCC title by splitting from the right', () => {
    const html = `<h2>Trabalho de Fim de Curso (1)</h2>
      <table class="listagem"><tr><td>
        Redes neurais, grafos e você, FULANO DE TAL, 03/2024
      </td></tr></table>`;
    expect(parseDocenteProducao(html).tccsOrientados).toEqual([
      { titulo: 'Redes neurais, grafos e você', ano: 2024 },
    ]);
  });

  it('returns zeros and empty lists for a docente with no production', () => {
    expect(parseDocenteProducao('<html><body></body></html>')).toEqual({
      tccsOrientados: [],
      orientacoes: {
        mestradoAndamento: 0,
        mestradoConcluidas: 0,
        doutoradoAndamento: 0,
        doutoradoConcluidas: 0,
      },
    });
  });
});
