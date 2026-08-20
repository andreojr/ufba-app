import { calcularStaleAfter } from './stale';

const DIA = 24 * 60 * 60 * 1000;

describe('calcularStaleAfter', () => {
  it('lands 30 days out, give or take three', () => {
    const agora = new Date('2026-08-19T12:00:00Z');
    for (let i = 0; i < 200; i += 1) {
      const delta = calcularStaleAfter(agora).getTime() - agora.getTime();
      expect(delta).toBeGreaterThanOrEqual(27 * DIA);
      expect(delta).toBeLessThanOrEqual(33 * DIA);
    }
  });

  // A term's docentes are all resolved in one burst, so a fixed TTL would expire
  // them in one burst too and dump every resync onto whoever crosses the line.
  it('spreads expiries instead of stacking them on one date', () => {
    const agora = new Date('2026-08-19T12:00:00Z');
    const valores = new Set(
      Array.from({ length: 50 }, () => calcularStaleAfter(agora).getTime()),
    );
    expect(valores.size).toBeGreaterThan(1);
  });
});
