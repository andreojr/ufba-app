import {
  TurmaVirtualService,
  FrontEndIdTurmaAusenteError,
  SigaaTurmaVirtualIndisponivelError,
} from './turma-virtual.service';
import type { SigaaSession } from './session';
import {
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';
import type { SigaaSessionFactory } from './sigaa-engine.service';
import type { TurmaVirtualRepository } from './turma-virtual.repository';

const MENU = '<form id="formMenu" action="/sigaa/ava/index.jsf"></form>';

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

/**
 * Uma home do portal com dois forms, pra provar que o casamento é por nome —
 * o link real do SIGAA não carrega o código do componente, só o nome
 * (confirmado contra sigaa.ufba.br).
 */
function portalHtml(): string {
  return [
    '<form id="form_acessarTurmaVirtual">',
    "<a onclick=\"jsfcljs(x,{'frontEndIdTurma':'token-fresco-sistemas-operacionais'},'')\">SISTEMAS OPERACIONAIS</a>",
    '</form>',
    '<form id="form_acessarTurmaVirtualj_id_1">',
    "<a onclick=\"jsfcljs(x,{'frontEndIdTurma':'token-fresco-redes'},'')\">REDES DE COMPUTADORES I</a>",
    '</form>',
  ].join('');
}

describe('TurmaVirtualService', () => {
  const NOTICIAS_HTML = `${MENU}<table class="listing"><tbody><tr><td>Início</td><td>18/08/2026</td><td class="icon"><a onclick="jsfcljs(x,{'id':'1'},'')"></a></td></tr></tbody></table>`;
  // Ordem real das colunas do SIGAA: Data, Hora, Descrição (ver avaliacoes.ts).
  const AVALIACOES_HTML = `${MENU}<table class="listing"><tbody><tr><td>06/10/2026</td><td>16h40</td><td>Prova 1</td></tr></tbody></table>`;
  const TOPICOS_HTML = `${MENU}<div class="topico-aula"><div class="titulo">Aula 1 (20/08/2026 - 20/08/2026)</div><div class="conteudotopico"></div></div>`;

  const FEED_RESPONSES = {
    '/sigaa/portais/discente/discente.jsf': portalHtml(),
    __entrarTurma__: `${MENU}<html>turma virtual principal</html>`,
    '/sigaa/ava/NoticiaTurma/listar.jsf': NOTICIAS_HTML,
    '/sigaa/ava/DataAvaliacao/listar.jsf': AVALIACOES_HTML,
    '/sigaa/ava/Relatorios/timeline.jsf': TOPICOS_HTML,
  };

  function servicoCom(
    session: SigaaSession,
    registro: { frontEndIdTurma: string | null; nome: string } | null,
  ): TurmaVirtualService {
    const createSession: SigaaSessionFactory = () => session;
    const repository: TurmaVirtualRepository = {
      buscarToken: jest.fn().mockResolvedValue(registro),
    };
    return new TurmaVirtualService(createSession, repository);
  }

  it('aggregates notícias, avaliações and tópicos into one feed', async () => {
    const session = fakeSession(FEED_RESPONSES);
    const service = servicoCom(session, {
      frontEndIdTurma: 'token-guardado',
      nome: 'SISTEMAS OPERACIONAIS',
    });

    const feed = await service.getFeed('turma-uuid', {
      login: 'a',
      senha: 'b',
    });

    expect(feed).toEqual({
      noticias: [{ id: '1', titulo: 'Início', data: '18/08/2026' }],
      avaliacoes: [{ descricao: 'Prova 1', data: '06/10/2026', hora: '16:40' }],
      topicos: [
        {
          titulo: 'Aula 1',
          periodo: '20/08/2026 - 20/08/2026',
          conteudoHtml: null,
        },
      ],
    });
  });

  // O token guardado é de uma sessão anterior e da linha Turma compartilhada
  // entre alunos — a home recém-lida deste aluno é a fonte de verdade.
  it('prefers the fresh token matched by nome over the stored one', async () => {
    const session = fakeSession(FEED_RESPONSES);
    const service = servicoCom(session, {
      frontEndIdTurma: 'token-guardado-velho',
      nome: 'REDES DE COMPUTADORES I',
    });

    await service.getFeed('turma-uuid', { login: 'a', senha: 'b' });

    expect(session.postback).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
      expect.objectContaining({ frontEndIdTurma: 'token-fresco-redes' }),
    );
  });

  it('falls back to the stored token when no form on the fresh page matches the nome', async () => {
    const session = fakeSession(FEED_RESPONSES);
    const service = servicoCom(session, {
      frontEndIdTurma: 'token-fresco-sistemas-operacionais',
      nome: 'LABORATÓRIO INTEGRADO III-A',
    });

    await service.getFeed('turma-uuid', { login: 'a', senha: 'b' });

    expect(session.postback).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
      expect.objectContaining({
        frontEndIdTurma: 'token-fresco-sistemas-operacionais',
      }),
    );
  });

  it('throws FrontEndIdTurmaAusenteError when there is neither a stored token nor a fresh match', async () => {
    const service = servicoCom(fakeSession({}), {
      frontEndIdTurma: null,
      nome: 'LABORATÓRIO INTEGRADO III-A',
    });

    await expect(
      service.getFeed('turma-uuid', { login: 'a', senha: 'b' }),
    ).rejects.toThrow(FrontEndIdTurmaAusenteError);
  });

  it('throws FrontEndIdTurmaAusenteError when the turma row does not exist', async () => {
    const service = servicoCom(fakeSession({}), null);

    await expect(
      service.getFeed('turma-uuid', { login: 'a', senha: 'b' }),
    ).rejects.toThrow(FrontEndIdTurmaAusenteError);
  });

  // Gotcha 1: o postback pode devolver 200 com a home do portal de volta.
  it('throws when the postback does not land inside the Turma Virtual', async () => {
    const session = fakeSession({
      ...FEED_RESPONSES,
      __entrarTurma__: '<html>de volta na home do portal</html>',
    });
    const service = servicoCom(session, {
      frontEndIdTurma: null,
      nome: 'SISTEMAS OPERACIONAIS',
    });

    await expect(
      service.getFeed('turma-uuid', { login: 'a', senha: 'b' }),
    ).rejects.toThrow(SigaaTurmaVirtualIndisponivelError);
    expect(session.get).not.toHaveBeenCalledWith(
      '/sigaa/ava/NoticiaTurma/listar.jsf',
    );
  });

  // Um relogin no meio de três GETs concorrentes corre em cima do cookie e do
  // ViewState compartilhados, e deixa a sessão fora da turma.
  it('fetches the three sections sequentially, in order', async () => {
    const session = fakeSession(FEED_RESPONSES);
    const service = servicoCom(session, {
      frontEndIdTurma: null,
      nome: 'SISTEMAS OPERACIONAIS',
    });

    await service.getFeed('turma-uuid', { login: 'a', senha: 'b' });

    const paths = (session.get as jest.Mock).mock.calls.map(
      ([path]) => path as string,
    );
    expect(paths).toEqual([
      '/sigaa/portais/discente/discente.jsf',
      '/sigaa/ava/NoticiaTurma/listar.jsf',
      '/sigaa/ava/DataAvaliacao/listar.jsf',
      '/sigaa/ava/Relatorios/timeline.jsf',
    ]);
  });

  describe.each([
    ['SigaaRateLimitedError', new SigaaRateLimitedError()],
    ['SigaaSessionExpiredError', new SigaaSessionExpiredError()],
    ['SigaaInvalidCredentialsError', new SigaaInvalidCredentialsError()],
  ])('re-throws %s unwrapped', (_nome, erro) => {
    it('from getFeed', async () => {
      const session = fakeSession(FEED_RESPONSES);
      (session.login as jest.Mock).mockRejectedValue(erro);
      const service = servicoCom(session, {
        frontEndIdTurma: 'x',
        nome: 'SISTEMAS OPERACIONAIS',
      });

      await expect(
        service.getFeed('turma-uuid', { login: 'a', senha: 'b' }),
      ).rejects.toBe(erro);
    });

    it('from getNoticiaDetalhe', async () => {
      const session = fakeSession(FEED_RESPONSES);
      (session.login as jest.Mock).mockRejectedValue(erro);
      const service = servicoCom(session, {
        frontEndIdTurma: 'x',
        nome: 'SISTEMAS OPERACIONAIS',
      });

      await expect(
        service.getNoticiaDetalhe('turma-uuid', '1', {
          login: 'a',
          senha: 'b',
        }),
      ).rejects.toBe(erro);
    });
  });
});
