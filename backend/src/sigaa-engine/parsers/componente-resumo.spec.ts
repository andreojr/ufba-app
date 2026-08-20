import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponenteResumo } from './componente-resumo';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseComponenteResumo', () => {
  it('extracts unidade, pré-requisito, co-requisito and equivalências as raw text', () => {
    const detalhe = parseComponenteResumo(
      fixture('componente-resumo-com-prerequisito.html'),
    );
    expect(detalhe.unidadeResponsavel).toBe(
      'DEPARTAMENTO DE ENGENHARIA AMBIENTAL/POLI - SALVADOR - 12.01.23.05',
    );
    expect(detalhe.preRequisito).toBe(
      '( FISD36 E FISD42 E QUI037 ) OU ( ENGJ18 ) OU ( FISD34 E ( QUIA27 OU ( FISD41 E QUI029 ) ) )',
    );
    expect(detalhe.coRequisito).toBeNull();
    expect(detalhe.equivalencias).toBe(
      '( ENG295A ) OU ( ENG295B ) OU ( ENG295C )',
    );
  });

  it('reads SIGAA\'s "-" placeholder as null, not the literal string', () => {
    const detalhe = parseComponenteResumo(
      fixture('componente-resumo-sem-prerequisito.html'),
    );
    expect(detalhe.preRequisito).toBeNull();
    expect(detalhe.coRequisito).toBeNull();
    // FISD36, being foundational, has no pré-requisito but DOES have a
    // recorded equivalência — the two fields are independent, and this
    // fixture is exactly the case that proves it.
    expect(detalhe.equivalencias).not.toBeNull();
  });
});
