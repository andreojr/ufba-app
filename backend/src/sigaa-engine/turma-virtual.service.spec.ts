import { TurmaVirtualService, FrontEndIdTurmaAusenteError } from './turma-virtual.service';
import type { SigaaSession } from './session';
import type { SigaaSessionFactory } from './sigaa-engine.service';
import type { TurmaVirtualRepository } from './turma-virtual.repository';

function fakeSession(responses: Record<string, string>): SigaaSession {
  return {
    login: jest.fn().mockResolvedValue(undefined),
    get: jest.fn((path: string) => Promise.resolve(responses[path] ?? '')),
    postback: jest.fn((path: string, fields: Record<string, string>) => {
      if (fields.frontEndIdTurma) {
        return Promise.resolve(responses['__entrarTurma__'] ?? '');
      }
      return Promise.resolve(responses['__postbackGenerico__'] ?? '');
    }),
  } as unknown as SigaaSession;
}

describe('TurmaVirtualService', () => {
  const PORTAL_HTML = `<form id="form_acessarTurmaVirtual"><input type="hidden" name="form_acessarTurmaVirtual" value="form_acessarTurmaVirtual" /><input type="hidden" name="frontEndIdTurma" value="token-123" /></form>`;
  const NOTICIAS_HTML = `<table class="listing"><tbody><tr><td>Início</td><td>18/08/2026</td><td class="icon"><a onclick="jsfcljs(x,{'id':'1'},'')"></a></td></tr></tbody></table>`;
  const AVALIACOES_HTML = `<table class="listing"><tbody><tr><td>Prova 1</td><td>06/10/2026</td></tr></tbody></table>`;
  const TOPICOS_HTML = `<div class="topico-aula"><div class="titulo">Aula 1 (20/08/2026 - 20/08/2026)</div><div class="conteudotopico"></div></div>`;

  it('aggregates notícias, avaliações and tópicos into one feed', async () => {
    const session = fakeSession({
      '/sigaa/portais/discente/discente.jsf': PORTAL_HTML,
      __entrarTurma__: '<html>turma virtual principal</html>',
      '/sigaa/ava/NoticiaTurma/listar.jsf': NOTICIAS_HTML,
      '/sigaa/ava/DataAvaliacao/listar.jsf': AVALIACOES_HTML,
      '/sigaa/ava/Relatorios/timeline.jsf': TOPICOS_HTML,
    });
    const createSession: SigaaSessionFactory = () => session;
    const repository: TurmaVirtualRepository = {
      buscarToken: jest.fn().mockResolvedValue({ frontEndIdTurma: 'token-123' }),
    };
    const service = new TurmaVirtualService(createSession, repository);

    const feed = await service.getFeed('turma-uuid', { login: 'a', senha: 'b' });

    expect(feed).toEqual({
      noticias: [{ id: '1', titulo: 'Início', data: '18/08/2026' }],
      avaliacoes: [{ descricao: 'Prova 1', data: '06/10/2026' }],
      topicos: [{ titulo: 'Aula 1', periodo: '20/08/2026 - 20/08/2026', conteudoHtml: null }],
    });
  });

  it('throws FrontEndIdTurmaAusenteError when the turma has no stored token', async () => {
    const createSession: SigaaSessionFactory = () => fakeSession({});
    const repository: TurmaVirtualRepository = {
      buscarToken: jest.fn().mockResolvedValue({ frontEndIdTurma: null }),
    };
    const service = new TurmaVirtualService(createSession, repository);

    await expect(
      service.getFeed('turma-uuid', { login: 'a', senha: 'b' }),
    ).rejects.toThrow(FrontEndIdTurmaAusenteError);
  });
});
