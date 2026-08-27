import { TurmaVirtualController } from './turma-virtual.controller';
import { TurmaVirtualService } from './turma-virtual.service';
import { PrismaService } from '../db/prisma.service';
import { PontoAtencaoService } from '../pontos-atencao/ponto-atencao.service';
import { ForbiddenException } from '@nestjs/common';

const AVALIACOES = [{ descricao: 'Prova 1', data: '06/10/2026' }];

describe('TurmaVirtualController', () => {
  function build(estaMatriculado: boolean) {
    const prisma = {
      matricula: {
        findUnique: jest.fn().mockResolvedValue(estaMatriculado ? { turmaId: 'turma-uuid' } : null),
      },
    } as unknown as PrismaService;
    const service = {
      getFeed: jest.fn().mockResolvedValue({ noticias: [], avaliacoes: AVALIACOES, topicos: [] }),
      getNoticiaDetalhe: jest.fn(),
    } as unknown as TurmaVirtualService;
    const pontoAtencaoService = {
      sincronizarDaTurmaVirtual: jest.fn().mockResolvedValue(undefined),
    } as unknown as PontoAtencaoService;
    return {
      controller: new TurmaVirtualController(service, prisma, pontoAtencaoService),
      service,
      pontoAtencaoService,
    };
  }

  it('returns the feed without avaliações — elas viram Ponto de Atenção, não se repetem aqui', async () => {
    const { controller } = build(true);

    const feed = await controller.getFeed(
      { userId: 'user-1' } as any,
      'turma-uuid',
      { login: 'a', senha: 'b' } as any,
    );

    expect(feed).toEqual({ noticias: [], topicos: [] });
    expect(feed).not.toHaveProperty('avaliacoes');
  });

  it('syncs avaliações into Pontos de Atenção before answering', async () => {
    const { controller, service, pontoAtencaoService } = build(true);

    await controller.getFeed(
      { userId: 'user-1' } as any,
      'turma-uuid',
      { login: 'a', senha: 'b' } as any,
    );

    expect(service.getFeed).toHaveBeenCalledWith('turma-uuid', { login: 'a', senha: 'b' });
    expect(pontoAtencaoService.sincronizarDaTurmaVirtual).toHaveBeenCalledWith(
      'user-1',
      'turma-uuid',
      AVALIACOES,
    );
  });

  it('rejects with 403 when the user is not matriculado nesta turma', async () => {
    const { controller } = build(false);

    await expect(
      controller.getFeed({ userId: 'user-1' } as any, 'turma-uuid', { login: 'a', senha: 'b' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
