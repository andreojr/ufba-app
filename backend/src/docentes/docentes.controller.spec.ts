import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocentesController } from './docentes.controller';
import { DocentesService } from './docentes.service';

function servicoFake(
  overrides: Partial<DocentesService> = {},
): DocentesService {
  return {
    resumoDoSemestre: jest.fn().mockResolvedValue([]),
    perfil: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DocentesService;
}

describe('DocentesController', () => {
  it('passes only turmas that name a docente through to the service', async () => {
    const resumoDoSemestre = jest.fn().mockResolvedValue([]);
    const controller = new DocentesController(
      servicoFake({ resumoDoSemestre }),
    );

    await controller.semestre({
      turmas: [
        { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
        { codigo: 'MATA59', nome: 'X', docente: '' },
      ],
    });

    expect(resumoDoSemestre).toHaveBeenCalledWith([
      { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
    ]);
  });

  it('404s on an unknown siape instead of returning an empty profile', async () => {
    const controller = new DocentesController(servicoFake());
    await expect(controller.detalhe('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the profile for a known siape', async () => {
    const perfil = jest
      .fn()
      .mockResolvedValue({ siape: '1815041', nome: 'FULANO' });
    const controller = new DocentesController(servicoFake({ perfil }));
    await expect(controller.detalhe('1815041')).resolves.toMatchObject({
      siape: '1815041',
    });
  });
});

/**
 * DTO validation only runs through Nest's HTTP pipeline — a direct method call
 * on the controller class (as above) bypasses pipes entirely. So these two
 * cases are driven over real HTTP with supertest, mirroring
 * sigaa.controller.http.spec.ts.
 */
describe('DocentesController (HTTP) — POST /docentes/semestre', () => {
  let app: INestApplication;
  let resumoDoSemestre: jest.Mock;

  beforeEach(async () => {
    resumoDoSemestre = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      controllers: [DocentesController],
      providers: [
        {
          provide: DocentesService,
          useValue: {
            resumoDoSemestre,
            perfil: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<{ user?: Record<string, string> }>();
          req.user = { userId: 'user-1', email: 'a@ufba.br', name: 'A' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('rejects a turma with no docente key with 400, never reaching the service', async () => {
    await request(app.getHttpServer())
      .post('/docentes/semestre')
      .send({ turmas: [{ codigo: 'X', nome: 'Y' }] })
      .expect(400);

    expect(resumoDoSemestre).not.toHaveBeenCalled();
  });

  it('accepts a well-formed body and calls the service (not rejected by the pipe)', async () => {
    // Nest's default status for a POST route with no @HttpCode is 201, not
    // 200 — the point of this test is "not rejected", not the exact code.
    await request(app.getHttpServer())
      .post('/docentes/semestre')
      .send({ turmas: [{ codigo: 'X', nome: 'Y', docente: 'FULANO' }] })
      .expect(201);

    expect(resumoDoSemestre).toHaveBeenCalledWith([
      { codigo: 'X', nome: 'Y', docente: 'FULANO' },
    ]);
  });
});
