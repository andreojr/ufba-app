import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCursoEstruturas } from './curso-estruturas';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseCursoEstruturas', () => {
  const estruturas = parseCursoEstruturas(fixture('curso-estruturas.html'));

  it('lists every curriculum structure with its código and status', () => {
    const codigos = estruturas.map((e) => e.codigo);
    expect(codigos).toEqual(
      expect.arrayContaining(['G20251', 'T20252', '186140']),
    );
  });

  it('identifies exactly one structure as ativa', () => {
    expect(estruturas.filter((e) => e.ativa)).toHaveLength(1);
    expect(estruturas.find((e) => e.ativa)?.codigo).toBe('G20251');
  });

  it("captures the jsfcljs params needed to click through to that structure's matrix", () => {
    const ativa = estruturas.find((e) => e.ativa);
    expect(ativa?.jsfParams.id).toMatch(/^\d+$/);
    expect(Object.keys(ativa!.jsfParams).length).toBeGreaterThanOrEqual(2);
  });
});
