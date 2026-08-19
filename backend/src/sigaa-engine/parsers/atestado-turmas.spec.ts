import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAtestadoTurmas } from './atestado-turmas';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'atestado-matricula.html');

describe('parseAtestadoTurmas', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('keeps only the turmas the student is actually enrolled in', () => {
    const { turmas } = parseAtestadoTurmas(html);

    // The document lists 7 rows; ECOB40 is INDEFERIDO, which the portal home
    // omits entirely — the schedule must not gain a class from switching source.
    expect(turmas).toHaveLength(6);
    expect(turmas.map((t) => t.codigo)).not.toContain('ECOB40');
  });

  it('extracts the course code, which the portal home does not carry at all', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const so = turmas.find((t) => t.nome === 'SISTEMAS OPERACIONAIS');

    expect(so?.codigo).toBe('MATA58');
  });

  it('extracts the docente name', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const so = turmas.find((t) => t.nome === 'SISTEMAS OPERACIONAIS');

    expect(so?.docente).toBe('BEATRIZ NUNES CAMPELO');
  });

  it('reports a docente as null when the row leaves it blank', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const redes = turmas.find((t) => t.nome === 'REDES DE COMPUTADORES I');

    expect(redes?.docente).toBeNull();
  });

  it('drops the "Local:" label the atestado prefixes the location with', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const lab = turmas.find((t) => t.nome === 'LABORATÓRIO INTEGRADO III-A');

    // Leaving the <b>Local:</b> text in would poison parseLocal's patterns and
    // silently blank out every predio/sala.
    expect(lab?.slots[0].localOriginal).toBe('ENG (ENG)');
    expect(lab?.slots[0].predio).toBe('ENG');
  });

  it('builds one slot per day with real time-of-day minutes', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const lab = turmas.find((t) => t.nome === 'LABORATÓRIO INTEGRADO III-A');

    expect(lab?.slots).toEqual([
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

  it('gives each day its own predio when the location names a different room per day', () => {
    const { turmas } = parseAtestadoTurmas(html);
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

  it('handles a horario cell with more than one code sharing a single validity period', () => {
    const { turmas } = parseAtestadoTurmas(html);
    const pcid = turmas.find(
      (t) => t.nome === 'PROJETO DE CIRCUITOS INTEGRADOS DIGITAIS',
    );

    expect(pcid?.slots.map((s) => [s.dia, s.inicioMin, s.fimMin])).toEqual([
      ['Segunda', 1110, 1220],
      ['Quarta', 1220, 1330],
    ]);
  });

  it('extracts the validity period from the horario cell', () => {
    const { turmas } = parseAtestadoTurmas(html);

    expect(turmas[0].vigencia).toEqual({
      inicio: '19/08/2026',
      fim: '19/12/2026',
    });
  });

  it('tags every turma with the semester from the identification table', () => {
    const { turmas } = parseAtestadoTurmas(html);

    expect(turmas.map((t) => t.semestre)).toEqual([
      '2026.2',
      '2026.2',
      '2026.2',
      '2026.2',
      '2026.2',
      '2026.2',
    ]);
  });

  it('extracts the periodo letivo with its dates normalized to ISO', () => {
    const { periodoLetivo } = parseAtestadoTurmas(html);

    expect(periodoLetivo).toEqual({
      semestre: '2026.2',
      inicio: '2026-08-19',
      fim: '2026-12-19',
    });
  });

  it('keeps a turma whose status cell is missing entirely', () => {
    // A deploy that doesn't render the status column must cost us one extra
    // turma at worst, never an empty schedule.
    const { turmas } = parseAtestadoTurmas(
      '<table id="matriculas"><tbody><tr>' +
        '<td class="codigo">MATA99</td>' +
        '<td><span class="componente">OPTATIVA SEM STATUS</span></td>' +
        '<td class="turma">01</td>' +
        '<td class="horario">2M12 (01/01/2026 - 01/06/2026)</td>' +
        '</tr></tbody></table>',
    );

    expect(turmas.map((t) => t.codigo)).toEqual(['MATA99']);
  });

  it('reports no turmas and no periodo letivo for a page that is not an atestado', () => {
    expect(
      parseAtestadoTurmas('<html><body>Sessão expirada</body></html>'),
    ).toEqual({ turmas: [], periodoLetivo: null });
  });
});
