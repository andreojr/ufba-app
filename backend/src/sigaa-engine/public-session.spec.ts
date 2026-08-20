import { PublicSigaaSession, getPaginaPublica } from './public-session';
import type {
  SigaaHttpClient,
  SigaaHttpRequest,
  SigaaHttpResponse,
} from './session';

function fakeHttp(responses: SigaaHttpResponse[]): {
  http: SigaaHttpClient;
  requests: SigaaHttpRequest[];
} {
  const requests: SigaaHttpRequest[] = [];
  let i = 0;
  return {
    requests,
    http: {
      request(req) {
        requests.push(req);
        const response = responses[i++];
        if (!response) throw new Error('fake http ran out of responses');
        return Promise.resolve(response);
      },
    },
  };
}

function pagina(viewState: string, corpo = ''): SigaaHttpResponse {
  return {
    status: 200,
    headers: { 'set-cookie': 'JSESSIONID=abc123; Path=/' },
    body: `${corpo}<input name="javax.faces.ViewState" value="${viewState}" />`,
  };
}

describe('PublicSigaaSession', () => {
  it('seeds cookie and ViewState from a cold GET before searching', async () => {
    const { http, requests } = fakeHttp([
      pagina('j_id1'),
      pagina('j_id2', '<table/>'),
    ]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('APOLINARIO');

    expect(requests[0].method).toBe('GET');
    expect(requests[1].method).toBe('POST');
    expect(requests[1].cookie).toBe('JSESSIONID=abc123');
    expect(requests[1].body?.['javax.faces.ViewState']).toBe('j_id1');
  });

  it('chains the ViewState across consecutive searches', async () => {
    const { http, requests } = fakeHttp([
      pagina('j_id1'),
      pagina('j_id2'),
      pagina('j_id3'),
    ]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('PRIMEIRO');
    await session.buscar('SEGUNDO');

    expect(requests[1].body?.['javax.faces.ViewState']).toBe('j_id1');
    expect(requests[2].body?.['javax.faces.ViewState']).toBe('j_id2');
  });

  it('sends the departamento-agnostic form SIGAA expects', async () => {
    const { http, requests } = fakeHttp([pagina('j_id1'), pagina('j_id2')]);
    const session = new PublicSigaaSession(http);

    await session.iniciar();
    await session.buscar('APOLINARIO');

    expect(requests[1].body).toMatchObject({
      form: 'form',
      'form:nome': 'APOLINARIO',
      'form:departamento': '0',
      'form:buscar': 'Buscar',
    });
  });

  it('refuses to search before iniciar, rather than posting cold and getting a 302', async () => {
    const { http } = fakeHttp([]);
    await expect(new PublicSigaaSession(http).buscar('X')).rejects.toThrow(
      /iniciar/,
    );
  });

  // A 429/500/503 can still carry an HTML body with no table and no
  // recognised error message — indistinguishable, to parseDocenteBusca, from
  // a genuine zero-result. buscar must throw before that body ever reaches
  // the parser, or an outage gets cached as a permanent false miss.
  it('rejects when the search POST answers a non-200 status', async () => {
    const { http } = fakeHttp([
      pagina('j_id1'),
      { status: 500, headers: {}, body: '<html>erro interno</html>' },
    ]);
    const session = new PublicSigaaSession(http);
    await session.iniciar();

    await expect(session.buscar('APOLINARIO')).rejects.toThrow(/500/);
  });
});

describe('getPaginaPublica', () => {
  it('returns the body on 200', async () => {
    const { http } = fakeHttp([
      { status: 200, headers: {}, body: '<html>ok</html>' },
    ]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1815041'),
    ).resolves.toBe('<html>ok</html>');
  });

  // An unknown siape answers 302, never 404 — validate on status, not body.
  it('returns null on the 302 an unknown siape produces', async () => {
    const { http } = fakeHttp([
      {
        status: 302,
        headers: { location: '/sigaa/public/home.jsf' },
        body: '',
      },
    ]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1'),
    ).resolves.toBeNull();
  });

  it('throws on an unexpected status so the caller does not record a false miss', async () => {
    const { http } = fakeHttp([{ status: 500, headers: {}, body: '' }]);
    await expect(
      getPaginaPublica(http, '/sigaa/public/docente/portal.jsf?siape=1815041'),
    ).rejects.toThrow(/500/);
  });
});
