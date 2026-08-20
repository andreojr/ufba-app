import { CurriculoPublicSession } from './curriculo-session';
import type { SigaaHttpClient, SigaaHttpRequest } from './session';

function fakeHttp(
  responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body: string;
  }>,
): SigaaHttpClient & { requests: SigaaHttpRequest[] } {
  const requests: SigaaHttpRequest[] = [];
  let i = 0;
  return {
    requests,
    async request(req) {
      requests.push(req);
      const res = responses[Math.min(i, responses.length - 1)];
      i++;
      return { status: res.status, headers: res.headers ?? {}, body: res.body };
    },
  };
}

const VIEW_STATE_HTML = (vs: string) =>
  `<input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="${vs}" />`;

describe('CurriculoPublicSession', () => {
  it('captures the ViewState and cookie from the opening GET', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/sigaa/public/curso/curriculo.jsf?id=1');
    expect(http.requests[0]).toMatchObject({ method: 'GET' });
  });

  it('throws if postar is called before abrir', async () => {
    const session = new CurriculoPublicSession(fakeHttp([{ status: 200, body: '' }]));
    await expect(session.postar('/x', {})).rejects.toThrow(
      'CurriculoPublicSession.abrir must run before postar',
    );
  });

  it('throws if the opening page carries no ViewState', async () => {
    const http = fakeHttp([{ status: 200, body: '<html></html>' }]);
    const session = new CurriculoPublicSession(http);
    await expect(session.abrir('/x')).rejects.toThrow(
      'SIGAA page carried no ViewState',
    );
  });

  it('sends the captured cookie and ViewState on postar, and updates the ViewState if the response carries a new one', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 200, body: VIEW_STATE_HTML('j_id2') },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await session.postar('/y', { foo: 'bar' });

    expect(http.requests[1]).toMatchObject({
      method: 'POST',
      path: '/y',
      cookie: 'JSESSIONID=ABC123.node1',
      body: { foo: 'bar', 'javax.faces.ViewState': 'j_id1' },
    });

    // a third call must now carry j_id2, proving the response's ViewState
    // was captured and will be sent on the next postar
    await session.postar('/z', {});
    expect(http.requests[2].body).toMatchObject({
      'javax.faces.ViewState': 'j_id2',
    });
  });

  it('leaves the ViewState unchanged when a response carries none — the component-detail response is a stateless leaf and must not reset the conversation', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 200, body: '<html>no view state here</html>' },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await session.postar('/detalhe', {});

    await session.postar('/detalhe-outro', {});
    expect(http.requests[2].body).toMatchObject({
      'javax.faces.ViewState': 'j_id1',
    });
  });

  it('throws on a non-200 status from abrir, before attempting to extract a ViewState', async () => {
    const http = fakeHttp([{ status: 500, body: 'internal error' }]);
    const session = new CurriculoPublicSession(http);
    await expect(session.abrir('/x')).rejects.toThrow(
      'Unexpected SIGAA response for /x: status 500',
    );
  });

  it('throws on a non-200 status from postar, without touching the captured ViewState', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 302, body: '' },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await expect(session.postar('/y', {})).rejects.toThrow(
      'Unexpected SIGAA response for /y: status 302',
    );
  });

  it('does not update the ViewState when capturarViewState is false, even if the response carries a new one', async () => {
    const http = fakeHttp([
      {
        status: 200,
        headers: { 'set-cookie': 'JSESSIONID=ABC123.node1; Path=/' },
        body: VIEW_STATE_HTML('j_id1'),
      },
      { status: 200, body: VIEW_STATE_HTML('j_id2') },
    ]);
    const session = new CurriculoPublicSession(http);
    await session.abrir('/x');
    await session.postar('/detalhe', {}, { capturarViewState: false });

    await session.postar('/depois', {});
    expect(http.requests[2].body).toMatchObject({
      'javax.faces.ViewState': 'j_id1',
    });
  });
});
