import {
  SigaaSession,
  SigaaHttpClient,
  SigaaHttpRequest,
  SigaaHttpResponse,
  SigaaInvalidCredentialsError,
  SigaaCredentialsRequiredError,
  SigaaSessionExpiredError,
} from './session';

const LOGIN_FORM_HTML = `
  <form name="loginForm" method="post" action="/sigaa/logar.do?dispatch=logOn">
    <center style="color: #922; font-weight: bold;">Usuário e/ou senha inválidos</center>
  </form>
`;

const PORTAL_HTML = `
  <span class="nome">Fulano de Tal</span>
  <input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="j_id1">
`;

const TURMA_HTML = `
  <div>Menu Turma Virtual</div>
  <input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="j_id2">
`;

/** Records every request made and returns canned responses in the order given. */
class FakeHttpClient implements SigaaHttpClient {
  public readonly requests: SigaaHttpRequest[] = [];
  private queue: SigaaHttpResponse[];

  constructor(responses: SigaaHttpResponse[]) {
    this.queue = [...responses];
  }

  request(req: SigaaHttpRequest): Promise<SigaaHttpResponse> {
    this.requests.push(req);
    const next = this.queue.shift();
    if (!next)
      throw new Error(
        `FakeHttpClient ran out of queued responses for ${req.method} ${req.path}`,
      );
    return Promise.resolve(next);
  }
}

function ok(body: string, setCookie?: string): SigaaHttpResponse {
  return {
    status: 200,
    headers: setCookie ? { 'set-cookie': setCookie } : {},
    body,
  };
}

function redirect(location: string, setCookie?: string): SigaaHttpResponse {
  return {
    status: 302,
    headers: { location, ...(setCookie ? { 'set-cookie': setCookie } : {}) },
    body: '',
  };
}

/**
 * Canned responses for a full successful login sequence, matching the 4
 * requests `SigaaSession.login` makes: root (seeds the session), the login
 * form page, the credentials POST (redirects to paginaInicial.do), and
 * actually following that redirect (SIGAA tracks server-side navigation
 * state, so a client that never lands on paginaInicial.do gets rejected as
 * an "invalid address" on the next portal page it requests).
 */
function loginResponses(cookie = 'JSESSIONID=abc123; Path=/; Secure') {
  return [
    ok(''), // GET /
    ok('', cookie), // GET /sigaa/verTelaLogin.do
    redirect('https://sigaa.ufba.br/sigaa/paginaInicial.do'), // POST logar.do
    ok(''), // GET /sigaa/paginaInicial.do (following the redirect)
  ];
}

describe('SigaaSession login', () => {
  it('succeeds on 302 redirect to paginaInicial.do', async () => {
    const http = new FakeHttpClient(loginResponses());
    const session = new SigaaSession(http);

    await expect(
      session.login({ login: 'user', senha: 'pass' }),
    ).resolves.toBeUndefined();
  });

  it('sends the exact form fields documented in the spike', async () => {
    const http = new FakeHttpClient(loginResponses());
    const session = new SigaaSession(http);

    await session.login({ login: 'joaosilva', senha: 'segredo' });

    expect(http.requests[2]).toMatchObject({
      method: 'POST',
      path: '/sigaa/logar.do?dispatch=logOn',
      body: {
        width: '1920',
        height: '1080',
        urlRedirect: '',
        subsistemaRedirect: '',
        acao: '',
        acessibilidade: '',
        'user.login': 'joaosilva',
        'user.senha': 'segredo',
      },
    });
  });

  it('follows the redirect to paginaInicial.do after a successful login', async () => {
    const http = new FakeHttpClient(loginResponses());
    const session = new SigaaSession(http);

    await session.login({ login: 'user', senha: 'pass' });

    expect(http.requests[3]).toMatchObject({
      method: 'GET',
      path: '/sigaa/paginaInicial.do',
      cookie: 'JSESSIONID=abc123',
    });
  });

  it('throws SigaaInvalidCredentialsError on 200 + loginForm', async () => {
    const http = new FakeHttpClient([
      ok(''),
      ok('', 'JSESSIONID=abc123; Path=/; Secure'),
      ok(LOGIN_FORM_HTML),
    ]);
    const session = new SigaaSession(http);

    await expect(
      session.login({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
  });

  it('throws a generic error on an unexpected response shape', async () => {
    const http = new FakeHttpClient([
      ok(''),
      ok('', 'JSESSIONID=abc123; Path=/; Secure'),
      { status: 500, headers: {}, body: '' },
    ]);
    const session = new SigaaSession(http);

    await expect(
      session.login({ login: 'user', senha: 'pass' }),
    ).rejects.toThrow(/500/);
  });
});

describe('SigaaSession authenticated navigation', () => {
  async function loggedInSession(extraResponses: SigaaHttpResponse[] = []) {
    const http = new FakeHttpClient([...loginResponses(), ...extraResponses]);
    const session = new SigaaSession(http);
    await session.login({ login: 'user', senha: 'pass' });
    return { session, http };
  }

  it('sends the stored JSESSIONID cookie on a GET', async () => {
    const { session, http } = await loggedInSession([ok(PORTAL_HTML)]);

    await session.get('/sigaa/portais/discente/discente.jsf');

    expect(http.requests[4]).toMatchObject({
      method: 'GET',
      path: '/sigaa/portais/discente/discente.jsf',
      cookie: 'JSESSIONID=abc123',
    });
  });

  it('captures the ViewState from the response and echoes it on the next postback', async () => {
    const { session, http } = await loggedInSession([
      ok(PORTAL_HTML),
      ok(TURMA_HTML),
    ]);

    await session.get('/sigaa/portais/discente/discente.jsf');
    await session.postback('/sigaa/portais/discente/discente.jsf', {
      frontEndIdTurma: 'ABC',
    });

    expect(http.requests[5].body).toMatchObject({
      frontEndIdTurma: 'ABC',
      'javax.faces.ViewState': 'j_id1',
    });
  });

  it('throws SigaaCredentialsRequiredError when the session expires and no credentials are stored', async () => {
    const http = new FakeHttpClient([...loginResponses(), ok(LOGIN_FORM_HTML)]);
    const session = new SigaaSession(http, { rememberCredentials: false });
    await session.login({ login: 'user', senha: 'pass' });

    await expect(
      session.get('/sigaa/portais/discente/discente.jsf'),
    ).rejects.toThrow(SigaaCredentialsRequiredError);
  });

  it('automatically re-logs in once and retries when credentials are remembered', async () => {
    const http = new FakeHttpClient([
      ...loginResponses(),
      ok(LOGIN_FORM_HTML), // session expired mid-navigation
      ...loginResponses('JSESSIONID=newsession456; Path=/; Secure'), // re-login
      ok(PORTAL_HTML), // retried request succeeds
    ]);
    const session = new SigaaSession(http, { rememberCredentials: true });
    await session.login({ login: 'user', senha: 'pass' });

    const result = await session.get('/sigaa/portais/discente/discente.jsf');

    expect(result).toBe(PORTAL_HTML);
    expect(http.requests[9]).toMatchObject({
      cookie: 'JSESSIONID=newsession456',
    });
  });

  it('throws SigaaSessionExpiredError if the retried request still shows the login form', async () => {
    const http = new FakeHttpClient([
      ...loginResponses(),
      ok(LOGIN_FORM_HTML),
      ...loginResponses('JSESSIONID=newsession456; Path=/; Secure'),
      ok(LOGIN_FORM_HTML),
    ]);
    const session = new SigaaSession(http, { rememberCredentials: true });
    await session.login({ login: 'user', senha: 'pass' });

    await expect(
      session.get('/sigaa/portais/discente/discente.jsf'),
    ).rejects.toThrow(SigaaSessionExpiredError);
  });
});

describe('SigaaSession.postbackBinary', () => {
  async function loggedInSession(extraResponses: SigaaHttpResponse[] = []) {
    const http = new FakeHttpClient([...loginResponses(), ...extraResponses]);
    const session = new SigaaSession(http);
    await session.login({ login: 'user', senha: 'pass' });
    return { session, http };
  }

  it('follows the redirect from the postback and returns the binary body', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf bytes');
    const { session, http } = await loggedInSession([
      redirect(
        'https://sigaa.ufba.br/sigaa/mobile/touch/gerarHistorico?sistema=2',
      ),
      { status: 200, headers: {}, body: '', bodyBuffer: pdfBuffer },
    ]);

    const result = await session.postbackBinary(
      '/sigaa/mobile/touch/menu.jsf',
      {
        'form-portal-discente:lnkConsultarHistorico':
          'form-portal-discente:lnkConsultarHistorico',
      },
    );

    expect(result).toBe(pdfBuffer);
    expect(http.requests[4]).toMatchObject({
      method: 'POST',
      path: '/sigaa/mobile/touch/menu.jsf',
      cookie: 'JSESSIONID=abc123',
    });
    expect(http.requests[5]).toMatchObject({
      method: 'GET',
      path: '/sigaa/mobile/touch/gerarHistorico?sistema=2',
      cookie: 'JSESSIONID=abc123',
    });
  });

  it('returns the response bytes directly when the postback answers 200 with a body (classic portal flow: discente.jsf responds with the PDF itself, no redirect)', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 classic flow bytes');
    const { session, http } = await loggedInSession([
      {
        status: 200,
        headers: {},
        body: '',
        bodyBuffer: pdfBuffer,
      },
    ]);

    const result = await session.postbackBinary(
      '/sigaa/portais/discente/discente.jsf',
      { jscook_action: 'menu:A]#{ portalDiscente.historico }' },
    );

    expect(result).toBe(pdfBuffer);
    expect(http.requests).toHaveLength(5);
    expect(http.requests[4]).toMatchObject({
      method: 'POST',
      path: '/sigaa/portais/discente/discente.jsf',
      cookie: 'JSESSIONID=abc123',
    });
  });

  it('throws if the postback yields neither a redirect nor a binary body', async () => {
    const { session } = await loggedInSession([
      ok('<html>page re-render without bytes</html>'),
    ]);

    await expect(
      session.postbackBinary('/sigaa/mobile/touch/menu.jsf', {}),
    ).rejects.toThrow(/binary/i);
  });
});

describe('SigaaSession.getAsset', () => {
  async function loggedInSession(extraResponses: SigaaHttpResponse[] = []) {
    const http = new FakeHttpClient([...loginResponses(), ...extraResponses]);
    const session = new SigaaSession(http);
    await session.login({ login: 'user', senha: 'pass' });
    return { session, http };
  }

  it('fetches a same-origin asset with the session cookie, returning its bytes and content-type', async () => {
    const css = Buffer.from('.matricula{}');
    const { session, http } = await loggedInSession([
      {
        status: 200,
        headers: { 'content-type': 'text/css;charset=ISO-8859-1' },
        body: '.matricula{}',
        bodyBuffer: css,
      },
    ]);

    const asset = await session.getAsset('/sigaa/css/atestado_matricula.css');

    expect(asset).toEqual({
      contentType: 'text/css;charset=ISO-8859-1',
      bytes: css,
    });
    expect(http.requests[4]).toMatchObject({
      method: 'GET',
      path: '/sigaa/css/atestado_matricula.css',
      cookie: 'JSESSIONID=abc123',
    });
  });

  it('returns null when the asset is missing (non-200), so the inliner can skip it', async () => {
    const { session } = await loggedInSession([
      { status: 404, headers: {}, body: 'not found' },
    ]);

    expect(await session.getAsset('/css/ufrn_print.css')).toBeNull();
  });
});
