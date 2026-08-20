import { calcularStaleAfter } from './stale';

describe('calcularStaleAfter', () => {
  it('lands roughly 30 days out, within the ±3 day jitter window', () => {
    const agora = new Date('2026-01-01T00:00:00Z');
    const staleAfter = calcularStaleAfter(agora);
    const diffDias =
      (staleAfter.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDias).toBeGreaterThanOrEqual(27);
    expect(diffDias).toBeLessThanOrEqual(33);
  });

  it('varies between calls, so a whole batch does not expire at once', () => {
    const agora = new Date('2026-01-01T00:00:00Z');
    const valores = new Set(
      Array.from({ length: 20 }, () => calcularStaleAfter(agora).getTime()),
    );
    expect(valores.size).toBeGreaterThan(1);
  });
});
