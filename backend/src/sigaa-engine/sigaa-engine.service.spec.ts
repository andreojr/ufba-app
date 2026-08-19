import { SigaaEngineService } from './sigaa-engine.service';
import { SigaaInvalidCredentialsError, SigaaSession } from './session';

const PORTAL_HTML = `
  <table style="margin-top: 1%;">
    <tbody>
      <tr><td colspan="5">2026.2</td></tr>
      <tr class="odd">
        <td class="descricao"><span>ENG999 - LABORATÓRIO INTEGRADO III-A</span></td>
        <td class="info">ENG (ENG)</td>
        <td class="info"><center>2N34 (19/08/2026 - 19/12/2026)</center></td>
      </tr>
    </tbody>
  </table>
`;

function fakeSession(
  overrides: Partial<{ login: jest.Mock; get: jest.Mock }> = {},
) {
  return {
    login: overrides.login ?? jest.fn().mockResolvedValue(undefined),
    get: overrides.get ?? jest.fn().mockResolvedValue(PORTAL_HTML),
    postback: jest.fn(),
  };
}

describe('SigaaEngineService.fetchSchedule', () => {
  it('logs in, fetches the portal home, and returns the parsed turmas', async () => {
    const session = fakeSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const turmas = await service.fetchSchedule({
      login: 'user',
      senha: 'pass',
    });

    expect(session.login).toHaveBeenCalledWith({
      login: 'user',
      senha: 'pass',
    });
    expect(session.get).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
    );
    expect(turmas).toHaveLength(1);
    expect(turmas[0].codigo).toBe('ENG999');
    expect(turmas[0].nome).toBe('LABORATÓRIO INTEGRADO III-A');
  });

  it('propagates SigaaInvalidCredentialsError without attempting to fetch the portal', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new SigaaInvalidCredentialsError());
    const session = fakeSession({ login });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchSchedule({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
    expect(session.get).not.toHaveBeenCalled();
  });

  it('creates a fresh session per call (credentials are never reused across calls)', async () => {
    const sessionFactory = jest.fn(
      () => fakeSession() as unknown as SigaaSession,
    );
    const service = new SigaaEngineService(sessionFactory);

    await service.fetchSchedule({ login: 'user', senha: 'pass' });
    await service.fetchSchedule({ login: 'user', senha: 'pass' });

    expect(sessionFactory).toHaveBeenCalledTimes(2);
  });
});
