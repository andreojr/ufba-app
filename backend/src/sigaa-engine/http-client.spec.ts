import {
  createSigaaHttpClient,
  decodeIso88591,
  encodeFormBody,
} from './http-client';

describe('decodeIso88591', () => {
  it('decodes accented characters correctly as Latin-1, not UTF-8', () => {
    // "inválidos" encoded as ISO-8859-1 bytes (á = 0xE1)
    const bytes = new Uint8Array([
      0x69, 0x6e, 0x76, 0xe1, 0x6c, 0x69, 0x64, 0x6f, 0x73,
    ]);

    expect(decodeIso88591(bytes.buffer)).toBe('inválidos');
  });
});

describe('encodeFormBody', () => {
  it('urlencodes form fields as application/x-www-form-urlencoded', () => {
    const body = encodeFormBody({
      'user.login': 'joao silva',
      'user.senha': 'a&b=c',
    });

    expect(body).toBe('user.login=joao+silva&user.senha=a%26b%3Dc');
  });

  it('produces an empty string for an empty body', () => {
    expect(encodeFormBody({})).toBe('');
  });
});

describe('createSigaaHttpClient request', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('forwards the response content-type header (needed to inline binary assets)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? 'image/gif' : null,
      },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const client = createSigaaHttpClient('https://sigaa.example');
    const response = await client.request({ method: 'GET', path: '/x.gif' });

    expect(response.headers['content-type']).toBe('image/gif');
  });

  /** Os headers com que o cliente chamou o fetch, já tipados. */
  function headersOf(fetchMock: jest.Mock): Record<string, string> {
    const [, init] = fetchMock.mock.calls[0] as [
      unknown,
      { headers: Record<string, string> },
    ];
    return init.headers;
  }

  function fetchStub(): jest.Mock {
    return jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  }

  it('se anuncia como navegador em vez do User-Agent padrão do Node', async () => {
    const fetchMock = fetchStub();
    global.fetch = fetchMock;

    const client = createSigaaHttpClient('https://sigaa.example');
    await client.request({ method: 'GET', path: '/sigaa/verTelaLogin.do' });

    const headers = headersOf(fetchMock);
    expect(headers['User-Agent']).toMatch(/Mozilla/);
    expect(headers['Accept-Language']).toContain('pt-BR');
  });

  it('manda Origin e Referer do próprio site nos POSTs de formulário', async () => {
    const fetchMock = fetchStub();
    global.fetch = fetchMock;

    const client = createSigaaHttpClient('https://sigaa.example');
    await client.request({
      method: 'POST',
      path: '/sigaa/logar.do?dispatch=logOn',
      body: { 'user.login': 'joao' },
      referer: '/sigaa/verTelaLogin.do',
    });

    const headers = headersOf(fetchMock);
    expect(headers['Origin']).toBe('https://sigaa.example');
    expect(headers['Referer']).toBe(
      'https://sigaa.example/sigaa/verTelaLogin.do',
    );
  });

  it('sem referer explícito, usa o próprio caminho do POST', async () => {
    const fetchMock = fetchStub();
    global.fetch = fetchMock;

    const client = createSigaaHttpClient('https://sigaa.example');
    await client.request({
      method: 'POST',
      path: '/sigaa/portais/discente/discente.jsf',
      body: { a: 'b' },
    });

    const headers = headersOf(fetchMock);
    expect(headers['Referer']).toBe(
      'https://sigaa.example/sigaa/portais/discente/discente.jsf',
    );
  });

  it('não manda Origin/Referer num GET', async () => {
    const fetchMock = fetchStub();
    global.fetch = fetchMock;

    const client = createSigaaHttpClient('https://sigaa.example');
    await client.request({ method: 'GET', path: '/sigaa/paginaInicial.do' });

    const headers = headersOf(fetchMock);
    expect(headers['Origin']).toBeUndefined();
    expect(headers['Referer']).toBeUndefined();
  });
});
