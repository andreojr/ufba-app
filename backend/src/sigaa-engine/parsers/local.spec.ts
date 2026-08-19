import { parseLocal } from './local';

describe('parseLocal', () => {
  it('extracts predio-only when no sala is assigned yet (e.g. lab turmas)', () => {
    const result = parseLocal('ENG (ENG)', ['Segunda']);

    expect(result).toEqual({
      Segunda: { predio: 'ENG', sala: null, localOriginal: 'ENG (ENG)' },
    });
  });

  it('extracts a fixed predio/sala repeated once per day/time segment', () => {
    const local =
      'PAF 1 - 208 - Terça Horários 18:30 às 19:25PAF 1 - 208 - Quinta Horários 18:30 às 19:25PAF 1 - 208 - Quinta Horários 19:25 às 20:20';

    const result = parseLocal(local, ['Terça', 'Quinta']);

    expect(result).toEqual({
      Terça: { predio: 'PAF 1', sala: '208', localOriginal: local },
      Quinta: { predio: 'PAF 1', sala: '208', localOriginal: local },
    });
  });

  it('extracts a fixed predio/sala where the sala uses dotted room numbers', () => {
    const local =
      'ENG - 7.1.5 - Segunda Horários 18:30 às 19:25ENG - 7.1.5 - Segunda Horários 19:25 às 20:20';

    const result = parseLocal(local, ['Segunda']);

    expect(result).toEqual({
      Segunda: { predio: 'ENG', sala: '7.1.5', localOriginal: local },
    });
  });

  it('splits per-day locations when the professor typed a different room per day', () => {
    const local = 'Ter PAF I/Qui Smart Class III';

    const result = parseLocal(local, ['Terça', 'Quinta']);

    expect(result).toEqual({
      Terça: { predio: 'PAF I', sala: null, localOriginal: local },
      Quinta: { predio: 'Smart Class III', sala: null, localOriginal: local },
    });
  });

  it('falls back to raw text for a day missing from a partially-recognized per-day pattern', () => {
    const local = 'Ter PAF I/???';

    const result = parseLocal(local, ['Terça', 'Quinta']);

    expect(result).toEqual({
      Terça: { predio: null, sala: null, localOriginal: local },
      Quinta: { predio: null, sala: null, localOriginal: local },
    });
  });

  it('falls back to raw text entirely when nothing recognizable matches', () => {
    const local = 'a combinar com o professor';

    const result = parseLocal(local, ['Sexta']);

    expect(result).toEqual({
      Sexta: { predio: null, sala: null, localOriginal: local },
    });
  });
});
