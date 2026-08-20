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

function fakeEngineService() {
  return {
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

const user = { userId: 'user-1', email: 'aluno@ufba.br', name: 'Aluno' };

describe('SigaaController', () => {
  it('POST sigaa/link delegates to SigaaLinkService with the authenticated userId', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
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
    );

    await controller.link(user, { login: 'joao', senha: 'segredo' });

    expect(linkService.link).toHaveBeenCalledWith(
      'user-1',
      { login: 'joao', senha: 'segredo' },
      false,
    );
  });

  it('POST sigaa/session delegates to SigaaEngineService and returns its result', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
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
    );

    expect(() => controller.grades()).toThrow(NotImplementedException);
  });

  it('GET sigaa/link returns linked: false when the service reports no link', async () => {
    const linkService = fakeLinkService();
    const controller = new SigaaController(
      linkService as any,
      fakeEngineService() as any,
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
    );

    await expect(controller.getLink(user)).resolves.toEqual({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
  });
});
