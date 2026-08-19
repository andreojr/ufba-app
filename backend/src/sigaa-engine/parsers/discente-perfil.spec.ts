import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDiscentePerfil } from './discente-perfil';

const fixture = readFileSync(
  join(__dirname, '__fixtures__', 'portal-discente-perfil.html'),
  'utf-8',
);

describe('parseDiscentePerfil', () => {
  it('extracts matrícula, curso and período de ingresso from the portal home', () => {
    expect(parseDiscentePerfil(fixture)).toEqual({
      matricula: '223116037',
      curso: 'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
      periodoIngresso: '2022.1',
    });
  });

  it('returns all-null instead of throwing when the agenda-docente block is missing', () => {
    expect(parseDiscentePerfil('<html><body>login page</body></html>')).toEqual(
      {
        matricula: null,
        curso: null,
        periodoIngresso: null,
      },
    );
  });

  it('accepts a "Período de Ingresso" label variant for the entry period', () => {
    const html = `
      <div id="agenda-docente"><table><tbody>
        <tr><td class="col1">Per&#237;odo de Ingresso:</td><td><b>2019.2</b></td></tr>
      </tbody></table></div>`;
    expect(parseDiscentePerfil(html).periodoIngresso).toBe('2019.2');
  });

  it('nulls the entry period when the value does not look like YYYY.N', () => {
    const html = `
      <div id="agenda-docente"><table><tbody>
        <tr><td class="col1">Entrada:</td><td><b>indefinida</b></td></tr>
      </tbody></table></div>`;
    expect(parseDiscentePerfil(html).periodoIngresso).toBeNull();
  });

  it('ignores unrelated rows and missing values', () => {
    const html = `
      <div id="agenda-docente"><table><tbody>
        <tr><td class="col1">Status:</td><td><b>ATIVO</b></td></tr>
        <tr><td class="col1">Matr&#237;cula:</td><td><b>  221109999 </b></td></tr>
        <tr><td class="col1">Curso:</td><td></td></tr>
      </tbody></table></div>`;
    expect(parseDiscentePerfil(html)).toEqual({
      matricula: '221109999',
      curso: null,
      periodoIngresso: null,
    });
  });
});
