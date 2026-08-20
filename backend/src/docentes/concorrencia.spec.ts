import { mapComLimite } from './concorrencia';

describe('mapComLimite', () => {
  it('keeps results in input order regardless of completion order', async () => {
    const resultado = await mapComLimite(
      [30, 10, 20],
      2,
      (ms) =>
        new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)),
    );
    expect(resultado).toEqual([30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let emVoo = 0;
    let pico = 0;
    await mapComLimite(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async () => {
        emVoo += 1;
        pico = Math.max(pico, emVoo);
        await new Promise((resolve) => setTimeout(resolve, 5));
        emVoo -= 1;
        return null;
      },
    );
    expect(pico).toBeLessThanOrEqual(4);
  });
});
