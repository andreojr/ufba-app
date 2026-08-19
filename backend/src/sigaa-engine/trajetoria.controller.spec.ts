import { TrajetoriaController } from './trajetoria.controller';
import type { HistoricoService } from './historico.service';
import type { TrajetoriaSalva } from './historico.repository';

// All three fields: RequestUser requires `name` too, and these specs pass the
// object with no cast — matching sigaa.controller.spec.ts's convention.
const USUARIO = { userId: 'user-1', email: 'maria@example.com', name: 'Maria' };

function salvaFalsa(): TrajetoriaSalva {
  return {
    historico: { indices: { cr: 8.1597, iap: 0.8434 } } as TrajetoriaSalva['historico'],
    fetchedAt: new Date('2026-08-19T03:35:00Z'),
    plano: [],
  };
}

describe('TrajetoriaController', () => {
  it('reports the unsynced state instead of an error when nothing is stored', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => null),
      sync: jest.fn(),
    } as unknown as HistoricoService;

    // The screen's fallback state is a normal outcome, not a failure: a brand
    // new user has simply never pressed the sync button.
    await expect(new TrajetoriaController(service).get(USUARIO)).resolves.toEqual({
      sincronizado: false,
    });
  });

  it('serialises fetchedAt as an ISO string so the client can show staleness', async () => {
    const service = {
      getTrajetoria: jest.fn(async () => salvaFalsa()),
      sync: jest.fn(),
    } as unknown as HistoricoService;

    const resposta = await new TrajetoriaController(service).get(USUARIO);

    expect(resposta).toMatchObject({ fetchedAt: '2026-08-19T03:35:00.000Z' });
  });

  it('returns the freshly synced aggregate, sparing the client a second call', async () => {
    const service = {
      getTrajetoria: jest.fn(),
      sync: jest.fn(async () => salvaFalsa()),
    } as unknown as HistoricoService;

    const resposta = await new TrajetoriaController(service).sync(USUARIO, {
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
