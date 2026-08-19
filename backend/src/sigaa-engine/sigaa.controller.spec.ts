import { NotImplementedException, StreamableFile } from '@nestjs/common';
import { SigaaController } from './sigaa.controller';

async function streamToBuffer(streamable: StreamableFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of streamable.getStream()) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function fakeLinkService() {
  return {
    link: jest.fn().mockResolvedValue(undefined),
    getLinkedCredentials: jest.fn().mockResolvedValue({ linked: false }),
  };
}

const perfil = {
  matricula: '223116037',
  curso: 'ENGENHARIA DE COMPUTAÇÃO',
  periodoIngresso: '2022.1',
};

const periodoLetivo = {
  semestre: '2026.2',
  inicio: '2026-08-19',
  fim: '2026-12-19',
};

function fakeEngineService() {
  return {
    fetchSchedule: jest.fn().mockResolvedValue({
      turmas: [{ componente: 'X' }],
      perfil,
      periodoLetivo,
    }),
    createWebSession: jest.fn().mockResolvedValue({
      sessionCookie: 'JSESSIONID=abc123.sigaapl06',
      targetUrl: 'https://sigaa.ufba.br/sigaa/portais/discente/discente.jsf',
    }),
    fetchHistorico: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
    fetchAtestado: jest
      .fn()
      .mockResolvedValue('<html><body>atestado</body></html>'),
  };
}

function fakeUserRepository() {
  return {
    updateSigaaProfile: jest.fn().mockResolvedValue(undefined),
  };
}

const user = { userId: 'user-1', email: 'aluno@ufba.br', name: 'Aluno' };

describe('SigaaController', () => {
  it('POST sigaa/link delegates to SigaaLinkService with the authenticated userId', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    const result = await controller.link(user, {
      login: 'joao',
      senha: 'segredo',
      rememberPassword: true,
    });

    expect(linkService.link).toHaveBeenCalledWith(
      'user-1',
      { login: 'joao', senha: 'segredo' },
      true,
    );
    expect(result).toEqual({ linked: true });
  });

  it('POST sigaa/link defaults rememberPassword to false when omitted', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    await controller.link(user, { login: 'joao', senha: 'segredo' });

    expect(linkService.link).toHaveBeenCalledWith(
      'user-1',
      { login: 'joao', senha: 'segredo' },
      false,
    );
  });

  it('POST schedule delegates to SigaaEngineService and returns the turmas', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
      fakeUserRepository() as any,
    );

    const result = await controller.schedule(user, {
      login: 'joao',
      senha: 'segredo',
    });

    expect(engineService.fetchSchedule).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
    expect(result.turmas).toEqual([{ componente: 'X' }]);
  });

  it('POST schedule returns the periodo letivo alongside the turmas', async () => {
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    const result = await controller.schedule(user, {
      login: 'joao',
      senha: 'segredo',
    });

    expect(result.periodoLetivo).toEqual(periodoLetivo);
  });

  it('POST schedule does not leak the perfil into the response', async () => {
    // The perfil is persisted server-side and read back through /me — the
    // schedule response is not its delivery channel.
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    const result = await controller.schedule(user, {
      login: 'joao',
      senha: 'segredo',
    });

    expect(Object.keys(result).sort()).toEqual(['periodoLetivo', 'turmas']);
  });

  it('POST schedule saves the scraped perfil for the authenticated user', async () => {
    const userRepository = fakeUserRepository();
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
      userRepository as any,
    );

    await controller.schedule(user, { login: 'joao', senha: 'segredo' });

    expect(userRepository.updateSigaaProfile).toHaveBeenCalledWith(
      'user-1',
      perfil,
    );
  });

  it('POST schedule still returns the turmas when saving the perfil fails', async () => {
    const userRepository = fakeUserRepository();
    userRepository.updateSigaaProfile.mockRejectedValue(
      new Error('db is down'),
    );
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
      userRepository as any,
    );

    await expect(
      controller.schedule(user, { login: 'joao', senha: 'segredo' }),
    ).resolves.toEqual({ turmas: [{ componente: 'X' }], periodoLetivo });
  });

  it('POST sigaa/session delegates to SigaaEngineService and returns its result', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
      fakeUserRepository() as any,
    );

    const result = await controller.session({
      login: 'joao',
      senha: 'segredo',
    });

    expect(engineService.createWebSession).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
    expect(result).toEqual({
      sessionCookie: 'JSESSIONID=abc123.sigaapl06',
      targetUrl: 'https://sigaa.ufba.br/sigaa/portais/discente/discente.jsf',
    });
  });

  it('POST sigaa/historico delegates to SigaaEngineService and streams back the PDF bytes', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
      fakeUserRepository() as any,
    );

    const result = await controller.historico({
      login: 'joao',
      senha: 'segredo',
    });

    expect(engineService.fetchHistorico).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
    expect(result).toBeInstanceOf(StreamableFile);
    expect((await streamToBuffer(result)).toString()).toBe('%PDF-1.4 fake');
  });

  it('POST sigaa/atestado delegates to SigaaEngineService and returns the self-contained HTML', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
      fakeUserRepository() as any,
    );

    const result = await controller.atestado({
      login: 'joao',
      senha: 'segredo',
    });

    expect(engineService.fetchAtestado).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
    expect(result).toBe('<html><body>atestado</body></html>');
  });

  it('GET grades throws NotImplementedException (parser pending real fixture)', () => {
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    expect(() => controller.grades()).toThrow(NotImplementedException);
  });

  it('GET sigaa/link returns linked: false when the service reports no link', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    await expect(controller.getLink(user)).resolves.toEqual({
      linked: false,
    });
    expect(linkService.getLinkedCredentials).toHaveBeenCalledWith('user-1');
  });

  it('GET sigaa/link returns the restored credential when the service finds one', async () => {
    const linkService = fakeLinkService();
    linkService.getLinkedCredentials.mockResolvedValue({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
      fakeUserRepository() as any,
    );

    await expect(controller.getLink(user)).resolves.toEqual({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
  });
});
