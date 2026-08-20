import { Logger } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import type { HorarioSalvo, ScheduleRepository } from './schedule.repository';
import type { Turma } from './parsers/turma';
import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { DiscentePerfil } from './parsers/discente-perfil';

const CREDENCIAIS = { login: '209900011', senha: 'segredo' };

const perfil: DiscentePerfil = {
  matricula: '223116037',
  curso: 'ENGENHARIA DE COMPUTAÇÃO',
  periodoIngresso: '2022.1',
};

const periodoLetivo: PeriodoLetivo = {
  semestre: '2026.2',
  inicio: '2026-08-19',
  fim: '2026-12-19',
};

function turmasFalsas(): Turma[] {
  return [
    {
      codigo: 'MATA37',
      nome: 'CÁLCULO A',
      docente: 'DR. ALGUEM',
      slots: [],
      vigencia: { inicio: '2026-08-19', fim: '2026-12-19' },
      semestre: '2026.2',
    },
  ];
}

// Silences ScheduleService's own success/warning logs: real output, not a
// mock artefact, but this suite has no interest in asserting on it and the
// standing requirement is pristine test output.
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
beforeAll(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterAll(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

function repositorioFalso(): jest.Mocked<ScheduleRepository> {
  return {
    salvar: jest.fn<Promise<void>, [string, Turma[], PeriodoLetivo | null]>(
      async () => undefined,
    ),
    buscar: jest.fn<Promise<HorarioSalvo | null>, [string]>(async () => null),
  };
}

function userRepositorioFalso() {
  return { updateSigaaProfile: jest.fn(async () => undefined) };
}

function downloaderFalso() {
  return {
    fetchSchedule: jest.fn(async () => ({
      turmas: turmasFalsas(),
      perfil,
      periodoLetivo,
    })),
  };
}

describe('ScheduleService', () => {
  it('downloads, persists and returns the schedule in one call', async () => {
    const repositorio = repositorioFalso();
    const salvo: HorarioSalvo = {
      turmas: turmasFalsas(),
      periodoLetivo,
      fetchedAt: new Date('2026-08-19T03:35:00Z'),
    };
    repositorio.buscar.mockResolvedValue(salvo);

    const service = new ScheduleService(
      downloaderFalso(),
      userRepositorioFalso(),
      repositorio,
    );

    // Returning the aggregate saves the client a second round trip.
    await expect(service.sync('user-1', CREDENCIAIS)).resolves.toBe(salvo);
    expect(repositorio.salvar).toHaveBeenCalledWith(
      'user-1',
      turmasFalsas(),
      periodoLetivo,
    );
  });

  it('saves the scraped perfil for the authenticated user', async () => {
    const userRepositorio = userRepositorioFalso();
    const repositorio = repositorioFalso();
    repositorio.buscar.mockResolvedValue({
      turmas: turmasFalsas(),
      periodoLetivo,
      fetchedAt: new Date(),
    });

    const service = new ScheduleService(
      downloaderFalso(),
      userRepositorio,
      repositorio,
    );
    await service.sync('user-1', CREDENCIAIS);

    expect(userRepositorio.updateSigaaProfile).toHaveBeenCalledWith('user-1', perfil);
  });

  it('still persists and returns the schedule when saving the perfil fails', async () => {
    const userRepositorio = userRepositorioFalso();
    userRepositorio.updateSigaaProfile.mockRejectedValue(new Error('db is down'));
    const repositorio = repositorioFalso();
    const salvo: HorarioSalvo = {
      turmas: turmasFalsas(),
      periodoLetivo,
      fetchedAt: new Date(),
    };
    repositorio.buscar.mockResolvedValue(salvo);

    const service = new ScheduleService(
      downloaderFalso(),
      userRepositorio,
      repositorio,
    );

    await expect(service.sync('user-1', CREDENCIAIS)).resolves.toBe(salvo);
    expect(repositorio.salvar).toHaveBeenCalled();
  });

  it('reports null for a user who has never synced', async () => {
    const service = new ScheduleService(
      downloaderFalso(),
      userRepositorioFalso(),
      repositorioFalso(),
    );

    await expect(service.getCached('user-1')).resolves.toBeNull();
  });
});
