import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurmasHorario } from './turmas-horario';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'portal-discente-turmas.html',
);

describe('parseTurmasHorario', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('parses every turma row in the "Minhas Turmas" table', () => {
    const turmas = parseTurmasHorario(html);

    expect(turmas).toHaveLength(5);
  });

  it('extracts the course name from the <a> link inside the descricao cell (real portal markup, not a bare <span>)', () => {
    const [first, second] = parseTurmasHorario(html);

    expect(first.codigo).toBeNull();
    expect(first.nome).toBe('LABORATÓRIO INTEGRADO III-A');
    expect(second.codigo).toBeNull();
    expect(second.nome).toBe('SISTEMAS OPERACIONAIS');
  });

  it('tags each turma with the semester header it appeared under', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.semestre).toBe('2026.2');
  });

  it('extracts the validity period from the schedule cell', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.vigencia).toEqual({ inicio: '19/08/2026', fim: '19/12/2026' });
  });

  it('builds one slot per day with real time-of-day minutes, ignoring any time text in Local', () => {
    const [first] = parseTurmasHorario(html);

    expect(first.slots).toEqual([
      {
        dia: 'Segunda',
        inicioMin: 1220,
        fimMin: 1330,
        predio: 'ENG',
        sala: null,
        localOriginal: 'ENG (ENG)',
      },
    ]);
  });

  it('applies a fixed predio/sala to every day of a turma when Local repeats the same one', () => {
    const [, second] = parseTurmasHorario(html);

    expect(second.slots).toEqual([
      {
        dia: 'Terça',
        inicioMin: 1110,
        fimMin: 1220,
        predio: 'PAF 1',
        sala: '208',
        localOriginal:
          'PAF 1 - 208 -  Terça Horários  18:30 às 19:25PAF 1 - 208 -  Quinta Horários  18:30 às 19:25',
      },
      {
        dia: 'Quinta',
        inicioMin: 1110,
        fimMin: 1220,
        predio: 'PAF 1',
        sala: '208',
        localOriginal:
          'PAF 1 - 208 -  Terça Horários  18:30 às 19:25PAF 1 - 208 -  Quinta Horários  18:30 às 19:25',
      },
    ]);
  });

  it('gives each day its own predio when the professor typed a different room per day', () => {
    const turmas = parseTurmasHorario(html);
    const redes = turmas.find((t) => t.nome === 'REDES DE COMPUTADORES I');

    expect(redes?.slots).toEqual([
      {
        dia: 'Terça',
        inicioMin: 1220,
        fimMin: 1330,
        predio: 'PAF I',
        sala: null,
        localOriginal: 'Ter PAF I/Qui Smart Class III',
      },
      {
        dia: 'Quinta',
        inicioMin: 1220,
        fimMin: 1330,
        predio: 'PAF II',
        sala: 'Smart Class III',
        localOriginal: 'Ter PAF I/Qui Smart Class III',
      },
    ]);
  });

  it('extracts predio/sala with dotted room numbers repeated across two days', () => {
    const turmas = parseTurmasHorario(html);
    const visao = turmas.find((t) => t.nome === 'VISÃO COMPUTACIONAL');

    expect(visao?.slots).toEqual([
      {
        dia: 'Segunda',
        inicioMin: 1000,
        fimMin: 1110,
        predio: 'ENG',
        sala: '7.1.3',
        localOriginal:
          'ENG - 7.1.3 -  Segunda Horários  16:40 às 17:35ENG - 7.1.3 -  Quarta Horários  16:40 às 17:35',
      },
      {
        dia: 'Quarta',
        inicioMin: 1000,
        fimMin: 1110,
        predio: 'ENG',
        sala: '7.1.3',
        localOriginal:
          'ENG - 7.1.3 -  Segunda Horários  16:40 às 17:35ENG - 7.1.3 -  Quarta Horários  16:40 às 17:35',
      },
    ]);
  });

  it('handles a schedule cell with more than one code sharing a single validity period (theory + lab on different days)', () => {
    const turmas = parseTurmasHorario(html);
    const pcid = turmas.find(
      (t) => t.nome === 'PROJETO DE CIRCUITOS INTEGRADOS DIGITAIS',
    );
    const localOriginal =
      'ENG - 7.1.5 -  Segunda Horários  18:30 às 19:25ENG - 7.1.5 -  Segunda Horários  19:25 às 20:20';

    expect(pcid?.slots).toEqual([
      {
        dia: 'Segunda',
        inicioMin: 1110,
        fimMin: 1220,
        predio: 'ENG',
        sala: '7.1.5',
        localOriginal,
      },
      {
        dia: 'Quarta',
        inicioMin: 1220,
        fimMin: 1330,
        predio: 'ENG',
        sala: '7.1.5',
        localOriginal,
      },
    ]);
  });

  it('handles a schedule cell with three or more codes (not just two)', () => {
    const turmas = parseTurmasHorario(
      '<table><tbody><tr><td class="descricao"><span>Turma com três horários</span></td>' +
        '<td class="info">Sala X</td>' +
        '<td class="info"><center>2M12 4T34 6N12 (01/01/2026 - 01/06/2026)</center></td></tr></tbody></table>',
    );

    expect(turmas[0].slots).toEqual([
      {
        dia: 'Segunda',
        inicioMin: 420,
        fimMin: 530,
        predio: null,
        sala: null,
        localOriginal: 'Sala X',
      },
      {
        dia: 'Quarta',
        inicioMin: 890,
        fimMin: 1000,
        predio: null,
        sala: null,
        localOriginal: 'Sala X',
      },
      {
        dia: 'Sexta',
        inicioMin: 1110,
        fimMin: 1220,
        predio: null,
        sala: null,
        localOriginal: 'Sala X',
      },
    ]);
  });

  it('splits componente into codigo + nome when a course code prefix IS present (defensive — not seen on real UFBA pages so far)', () => {
    const turmas = parseTurmasHorario(
      '<table><tbody><tr><td class="descricao"><span>MATA99 - Optativa com código</span></td><td class="info">Sala X</td><td class="info"><center>2M12 (01/01/2026 - 01/06/2026)</center></td></tr></tbody></table>',
    );

    expect(turmas[0].codigo).toBe('MATA99');
    expect(turmas[0].nome).toBe('Optativa com código');
  });

  it('falls back to codigo: null when componente has no recognizable course-code prefix', () => {
    const turmas = parseTurmasHorario(
      '<table><tbody><tr><td class="descricao"><span>Optativa sem código</span></td><td class="info">Sala X</td><td class="info"><center>2M12 (01/01/2026 - 01/06/2026)</center></td></tr></tbody></table>',
    );

    expect(turmas[0].codigo).toBeNull();
    expect(turmas[0].nome).toBe('Optativa sem código');
  });

  it('returns an empty list for a table with no turma rows', () => {
    const emptyHtml =
      '<table><thead><tr><th>Componente Curricular</th></tr></thead><tbody></tbody></table>';

    expect(parseTurmasHorario(emptyHtml)).toEqual([]);
  });
});
