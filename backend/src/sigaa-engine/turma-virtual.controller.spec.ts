import { TurmaVirtualController } from './turma-virtual.controller';
import { TurmaVirtualService } from './turma-virtual.service';
import { PrismaService } from '../db/prisma.service';
import { ForbiddenException } from '@nestjs/common';

describe('TurmaVirtualController', () => {
  function build(estaMatriculado: boolean) {
    const prisma = {
      matricula: {
        findUnique: jest.fn().mockResolvedValue(estaMatriculado ? { turmaId: 'turma-uuid' } : null),
      },
    } as unknown as PrismaService;
    const service = {
      getFeed: jest.fn().mockResolvedValue({ noticias: [], avaliacoes: [], topicos: [] }),
      getNoticiaDetalhe: jest.fn(),
    } as unknown as TurmaVirtualService;
    return { controller: new TurmaVirtualController(service, prisma), service };
  }

  it('returns the feed when the user is matriculado', async () => {
    const { controller, service } = build(true);

    const feed = await controller.getFeed(
      { userId: 'user-1' } as any,
      'turma-uuid',
      { login: 'a', senha: 'b' } as any,
    );

    expect(feed).toEqual({ noticias: [], avaliacoes: [], topicos: [] });
    expect(service.getFeed).toHaveBeenCalledWith('turma-uuid', { login: 'a', senha: 'b' });
  });

  it('rejects with 403 when the user is not matriculado nesta turma', async () => {
    const { controller } = build(false);

    await expect(
      controller.getFeed({ userId: 'user-1' } as any, 'turma-uuid', { login: 'a', senha: 'b' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
