import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurriculoController } from './curriculo.controller';
import { CURRICULO_SERVICE } from './tokens';
import type { CurriculoService } from './curriculo.service';

describe('CurriculoController', () => {
  let app: INestApplication;
  const service: jest.Mocked<Pick<CurriculoService, 'listarCursos' | 'resolverCurso' | 'resolverPorNomeUsuario'>> = {
    listarCursos: jest.fn(),
    resolverCurso: jest.fn(),
    resolverPorNomeUsuario: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CurriculoController],
      providers: [{ provide: CURRICULO_SERVICE, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx) => {
        ctx.switchToHttp().getRequest().user = { userId: 'u1' };
        return true;
      } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('GET /curriculo/cursos returns the directory', async () => {
    service.listarCursos.mockResolvedValue([
      { idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' },
    ]);
    const res = await request(app.getHttpServer()).get('/curriculo/cursos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]);
  });

  it('GET /curriculo/cursos/:cursoId returns the resolved structure', async () => {
    service.resolverCurso.mockResolvedValue({ codigo: 'G20251' } as any);
    const res = await request(app.getHttpServer()).get('/curriculo/cursos/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ codigo: 'G20251' });
    expect(service.resolverCurso).toHaveBeenCalledWith('1');
  });

  it('GET /curriculo/meu-curso resolves against the current user (no user.curso wiring yet — accepts a query param for now)', async () => {
    service.resolverPorNomeUsuario.mockResolvedValue({ codigo: 'G20251' } as any);
    const res = await request(app.getHttpServer())
      .get('/curriculo/meu-curso')
      .query({ curso: 'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador' });
    expect(res.status).toBe(200);
    expect(service.resolverPorNomeUsuario).toHaveBeenCalledWith(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
    );
  });
});
