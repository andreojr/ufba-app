import { NotImplementedException } from '@nestjs/common';
import { SigaaController } from './sigaa.controller';

function fakeLinkService() {
  return { link: jest.fn().mockResolvedValue(undefined) };
}

function fakeEngineService() {
  return { fetchSchedule: jest.fn().mockResolvedValue([{ componente: 'X' }]) };
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

  it('GET schedule delegates to SigaaEngineService and returns its result', async () => {
    const engineService = fakeEngineService();
    const controller = new SigaaController(
      fakeLinkService() as any,
      engineService as any,
    );

    const result = await controller.schedule({
      login: 'joao',
      senha: 'segredo',
    });

    expect(engineService.fetchSchedule).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
    expect(result).toEqual([{ componente: 'X' }]);
  });

  it('GET grades throws NotImplementedException (parser pending real fixture)', () => {
    const controller = new SigaaController(
      fakeLinkService() as any,
      fakeEngineService() as any,
    );

    expect(() => controller.grades()).toThrow(NotImplementedException);
  });
});
