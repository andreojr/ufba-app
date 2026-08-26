import { ScheduleController } from './schedule.controller';
import type { ScheduleService } from './schedule.service';
import type { HorarioSalvo } from './schedule.repository';

const USUARIO = { userId: 'user-1', email: 'maria@example.com', name: 'Maria' };

function horarioFalso(): HorarioSalvo {
  return {
    turmas: [
      {
        id: 'turma-1',
        codigo: 'MATA37',
        nome: 'CÁLCULO A',
        numero: '01',
        docente: 'DR. ALGUEM',
        frontEndIdTurma: null,
        idTurmaSigaa: null,
        slots: [],
        vigencia: { inicio: '2026-08-19', fim: '2026-12-19' },
        semestre: '2026.2',
      },
    ],
    periodoLetivo: { semestre: '2026.2', inicio: '2026-08-19', fim: '2026-12-19' },
    fetchedAt: new Date('2026-08-19T03:35:00Z'),
  };
}

describe('ScheduleController', () => {
  it('reports the unsynced state instead of an error when nothing is stored', async () => {
    const service = {
      getCached: jest.fn(async () => null),
      sync: jest.fn(),
    } as unknown as ScheduleService;

    // The screen's fallback state is a normal outcome, not a failure: a brand
    // new user has simply never pressed the sync button.
    await expect(new ScheduleController(service).get(USUARIO)).resolves.toEqual({
      sincronizado: false,
    });
  });

  it('serialises fetchedAt as an ISO string so the client can show staleness', async () => {
    const service = {
      getCached: jest.fn(async () => horarioFalso()),
      sync: jest.fn(),
    } as unknown as ScheduleService;

    const resposta = await new ScheduleController(service).get(USUARIO);

    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });

  it('GET schedule returns the cached turmas and periodoLetivo', async () => {
    const service = {
      getCached: jest.fn(async () => horarioFalso()),
      sync: jest.fn(),
    } as unknown as ScheduleService;

    const resposta = await new ScheduleController(service).get(USUARIO);

    const { frontEndIdTurma: _fe, idTurmaSigaa: _id, ...turmaEsperada } =
      horarioFalso().turmas[0];
    expect(resposta).toMatchObject({
      turmas: [turmaEsperada],
      periodoLetivo: horarioFalso().periodoLetivo,
    });
  });

  // Tokens opacos de sessão do SIGAA, numa linha Turma compartilhada entre
  // alunos: nenhum cliente precisa deles, então não viajam no payload.
  it('does not leak the Turma Virtual tokens in the response', async () => {
    const service = {
      getCached: jest.fn(async () => horarioFalso()),
      sync: jest.fn(),
    } as unknown as ScheduleService;

    const resposta = await new ScheduleController(service).get(USUARIO);

    expect(JSON.stringify(resposta)).not.toContain('frontEndIdTurma');
    expect(JSON.stringify(resposta)).not.toContain('idTurmaSigaa');
  });

  it('POST schedule/sync delegates to ScheduleService with the authenticated userId', async () => {
    const service = {
      getCached: jest.fn(),
      sync: jest.fn(async () => horarioFalso()),
    } as unknown as ScheduleService;

    const resposta = await new ScheduleController(service).sync(USUARIO, {
      login: '209900011',
      senha: 'segredo',
    });

    expect(service.sync).toHaveBeenCalledWith('user-1', {
      login: '209900011',
      senha: 'segredo',
    });
    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });
});
