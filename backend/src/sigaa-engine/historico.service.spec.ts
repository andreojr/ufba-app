import { Logger } from '@nestjs/common';
import { HistoricoService } from './historico.service';
import type { HistoricoRepository, TrajetoriaSalva } from './historico.repository';
import type { Historico } from './parsers/historico';

const CREDENCIAIS = { login: '209900011', senha: 'segredo' };

// Silences HistoricoService's own success log: real output, not a mock
// artefact, but this suite has no interest in asserting on it and the
// standing requirement is pristine test output.
let logSpy: jest.SpyInstance;
beforeAll(() => {
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  logSpy.mockRestore();
});

function historicoFalso(): Historico {
  return {
    emitidoEm: '2026-08-19',
    curriculo: 'G20251 - 2025.2',
    periodoLetivoAtual: 8,
    prazoConclusaoPadrao: '2030.1',
    prazoConclusaoMaximo: '2033.1',
    indices: { cr: 8.1597, iap: 0.8434 },
    cursados: [
      // Concluded: grants integralized hours, so it belongs in the
      // reconciliation's positive list.
      {
        semestre: '2023.1',
        natureza: 'OB',
        codigo: 'FISD36',
        nome: 'FÍSICA',
        cargaHoraria: 60,
        nota: 6.8,
        situacao: 'APR',
        docente: null,
      },
      // Not concluded: reprovado grants no hours, so its código must NOT
      // appear in reconciliarPlano's list even though it is also not pending.
      {
        semestre: '2023.2',
        natureza: 'OB',
        codigo: 'MATA37',
        nome: 'CÁLCULO',
        cargaHoraria: 60,
        nota: 3.0,
        situacao: 'REP',
        docente: null,
      },
    ],
    pendentesObrigatorios: [
      { codigo: 'MATA59', nome: 'REDES', cargaHoraria: 60, matriculado: true },
      { codigo: 'MATA60', nome: 'BANCO DE DADOS', cargaHoraria: 60, matriculado: false },
    ],
    cargaHoraria: {
      obrigatorias: { exigida: 3150, integralizada: 2100, pendente: 1050 },
      optativas: { exigida: 360, integralizada: 0, pendente: 360 },
      complementares: { exigida: 100, integralizada: 0, pendente: 100 },
      total: { exigida: 3610, integralizada: 2100, pendente: 1510 },
    },
    equivalencias: [],
    observacoes: [],
  };
}

function repositorioFalso(): jest.Mocked<HistoricoRepository> {
  return {
    salvar: jest.fn<Promise<void>, [string, Historico]>(async () => undefined),
    buscar: jest.fn<Promise<TrajetoriaSalva | null>, [string]>(async () => null),
    reconciliarPlano: jest.fn<Promise<void>, [string, string[]]>(async () => undefined),
  };
}

describe('HistoricoService', () => {
  it('downloads, parses, persists and returns the trajectory in one call', async () => {
    const repositorio = repositorioFalso();
    const salva: TrajetoriaSalva = {
      historico: historicoFalso(),
      fetchedAt: new Date('2026-08-19T03:35:00Z'),
      plano: [],
    };
    repositorio.buscar.mockResolvedValue(salva);

    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );

    // Returning the aggregate saves the client a second round trip after a
    // wait long enough to need a progress indicator.
    await expect(service.sync('user-1', CREDENCIAIS)).resolves.toBe(salva);
    expect(repositorio.salvar).toHaveBeenCalledWith('user-1', expect.any(Object));
  });

  it('reconciles the plan against components that actually concluded, not the pending list', async () => {
    const repositorio = repositorioFalso();
    repositorio.buscar.mockResolvedValue({
      historico: historicoFalso(),
      fetchedAt: new Date(),
      plano: [],
    });

    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );
    await service.sync('user-1', CREDENCIAIS);

    // FISD36 (APR) concluded and should be dropped from the plan if present;
    // MATA37 (REP) did not, so it must be absent even though it is also not
    // pending; MATA59/MATA60 are still pending and must never appear here.
    expect(repositorio.reconciliarPlano).toHaveBeenCalledWith('user-1', ['FISD36']);
  });

  it('persists nothing when the parser rejects the document', async () => {
    const repositorio = repositorioFalso();
    const service = new HistoricoService(
      { fetchHistorico: jest.fn(async () => Buffer.from('%PDF-fake')) },
      jest.fn(async () => []),
      jest.fn(() => {
        throw new Error('Histórico inconsistente: o CR recalculado não bate');
      }),
      repositorio,
    );

    // The previous snapshot has to survive a bad parse — a student who synced
    // successfully last term must not lose their trajectory to a parser bug.
    await expect(service.sync('user-1', CREDENCIAIS)).rejects.toThrow(/CR/);
    expect(repositorio.salvar).not.toHaveBeenCalled();
    expect(repositorio.reconciliarPlano).not.toHaveBeenCalled();
  });

  it('reports null for a user who has never synced', async () => {
    const repositorio = repositorioFalso();
    const service = new HistoricoService(
      { fetchHistorico: jest.fn() },
      jest.fn(async () => []),
      jest.fn(() => historicoFalso()),
      repositorio,
    );

    await expect(service.getTrajetoria('user-1')).resolves.toBeNull();
  });
});
