import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { USER_REPOSITORY } from '../db/tokens';
import { SigaaEngineService } from './sigaa-engine.service';
import { SigaaLinkService } from './sigaa-link.service';
import { SigaaController } from './sigaa.controller';

/**
 * Exercises SigaaController.historico over a real HTTP response (supertest),
 * not just a direct method call — StreamableFile's actual byte delivery only
 * shows up at the HTTP layer, not when the controller method is called
 * in-process (see the "0 KB download" bug this test reproduces/guards).
 */
describe('SigaaController (HTTP) — GET /sigaa/historico', () => {
  let app: INestApplication;

  async function buildApp(pdfBytes: Buffer): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [SigaaController],
      providers: [
        {
          provide: SigaaLinkService,
          useValue: {},
        },
        {
          provide: SigaaEngineService,
          useValue: {
            fetchHistorico: jest.fn().mockResolvedValue(pdfBytes),
          },
        },
        {
          provide: USER_REPOSITORY,
          useValue: {},
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

    const builtApp = moduleRef.createNestApplication();
    await builtApp.init();
    return builtApp;
  }

  afterEach(async () => {
    await app?.close();
  });

  it('delivers the full PDF byte count over the wire, not a truncated/empty body', async () => {
    const pdfBytes = Buffer.from(
      '%PDF-1.4 ' + 'x'.repeat(20_000), // large enough to span multiple TCP chunks
    );
    app = await buildApp(pdfBytes);

    const response = await request(app.getHttpServer())
      .post('/sigaa/historico')
      .send({ login: 'user', senha: 'pass' })
      .expect('Content-Type', 'application/pdf');

    expect(Buffer.from(response.body).length).toBe(pdfBytes.length);
    expect(Buffer.from(response.body).equals(pdfBytes)).toBe(true);
  });
});
