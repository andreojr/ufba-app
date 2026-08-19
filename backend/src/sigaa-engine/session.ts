export interface SigaaHttpRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, string>;
  cookie?: string;
}

export interface SigaaHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SigaaHttpClient {
  request(req: SigaaHttpRequest): Promise<SigaaHttpResponse>;
}

export interface SigaaCredentials {
  login: string;
  senha: string;
}

export interface SigaaSessionOptions {
  /**
   * Whether to keep the credentials in memory for this session instance so a single
   * automatic relogin can be attempted if the SIGAA session expires mid-navigation.
   * Has nothing to do with persisting credentials to disk (see credential-vault.ts).
   */
  rememberCredentials?: boolean;
}

export class SigaaInvalidCredentialsError extends Error {
  constructor() {
    super('SIGAA rejected the provided credentials');
    this.name = 'SigaaInvalidCredentialsError';
  }
}

export class SigaaCredentialsRequiredError extends Error {
  constructor() {
    super(
      'SIGAA session expired and no credentials are available to relogin automatically',
    );
    this.name = 'SigaaCredentialsRequiredError';
  }
}

export class SigaaSessionExpiredError extends Error {
  constructor() {
    super(
      'SIGAA session expired and the automatic relogin attempt did not recover it',
    );
    this.name = 'SigaaSessionExpiredError';
  }
}

const LOGIN_FORM_MARKER = '<form name="loginForm"';
const INVALID_CREDENTIALS_MARKER = 'Usuário e/ou senha inválidos';
const VIEW_STATE_PATTERN = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID_PATTERN = /JSESSIONID=[^;]+/;

function isLoginFormResponse(response: SigaaHttpResponse): boolean {
  return (
    response.status === 200 &&
    (response.body.includes(LOGIN_FORM_MARKER) ||
      response.body.includes(INVALID_CREDENTIALS_MARKER))
  );
}

export class SigaaSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;
  private credentials: SigaaCredentials | undefined;
  private readonly rememberCredentials: boolean;

  constructor(
    private readonly http: SigaaHttpClient,
    options: SigaaSessionOptions = {},
  ) {
    this.rememberCredentials = options.rememberCredentials ?? true;
  }

  async login(credentials: SigaaCredentials): Promise<void> {
    // The session must originate from the site root (which 302s to
    // /sigaa/public/home.jsf and seeds the first JSESSIONID) — jumping
    // straight to an internal .do endpoint from a cold client trips SIGAA's
    // "invalid address, use the links offered by the system" guard.
    const root = await this.http.request({ method: 'GET', path: '/' });
    this.captureCookie(root);

    const initial = await this.http.request({
      method: 'GET',
      path: '/sigaa/verTelaLogin.do',
      cookie: this.jsessionId,
    });
    this.captureCookie(initial);

    const response = await this.http.request({
      method: 'POST',
      path: '/sigaa/logar.do?dispatch=logOn',
      cookie: this.jsessionId,
      body: {
        width: '1920',
        height: '1080',
        urlRedirect: '',
        subsistemaRedirect: '',
        acao: '',
        acessibilidade: '',
        'user.login': credentials.login,
        'user.senha': credentials.senha,
      },
    });
    this.captureCookie(response);

    if (
      response.status === 302 &&
      (response.headers.location ?? '').includes('paginaInicial.do')
    ) {
      // Actually follow the redirect (fetch is configured with redirect:
      // 'manual', so this doesn't happen automatically). SIGAA's JSF layer
      // tracks server-side navigation state; jumping straight to a portal
      // subpage without ever landing on paginaInicial.do first trips its
      // "invalid address, use the links offered by the system" guard.
      const landing = await this.http.request({
        method: 'GET',
        path: '/sigaa/paginaInicial.do',
        cookie: this.jsessionId,
      });
      this.captureCookie(landing);

      if (this.rememberCredentials) {
        this.credentials = credentials;
      }
      return;
    }

    if (isLoginFormResponse(response)) {
      throw new SigaaInvalidCredentialsError();
    }

    throw new Error(
      `Unexpected SIGAA login response: status ${response.status}`,
    );
  }

  async get(path: string): Promise<string> {
    return this.authenticatedRequest({ method: 'GET', path });
  }

  async postback(
    path: string,
    fields: Record<string, string>,
  ): Promise<string> {
    return this.authenticatedRequest({
      method: 'POST',
      path,
      body: { ...fields, 'javax.faces.ViewState': this.viewState ?? '' },
    });
  }

  private async authenticatedRequest(
    req: {
      method: 'GET' | 'POST';
      path: string;
      body?: Record<string, string>;
    },
    isRetryAfterRelogin = false,
  ): Promise<string> {
    if (!this.jsessionId) {
      throw new Error(
        'SigaaSession.login must succeed before making authenticated requests',
      );
    }

    const response = await this.http.request({
      ...req,
      cookie: this.jsessionId,
    });
    this.captureCookie(response);

    if (isLoginFormResponse(response)) {
      if (isRetryAfterRelogin) {
        throw new SigaaSessionExpiredError();
      }
      if (!this.credentials) {
        throw new SigaaCredentialsRequiredError();
      }
      await this.login(this.credentials);
      return this.authenticatedRequest(req, true);
    }

    this.captureViewState(response.body);
    return response.body;
  }

  private captureCookie(response: SigaaHttpResponse): void {
    const setCookie = response.headers['set-cookie'];
    if (!setCookie) return;
    const match = JSESSIONID_PATTERN.exec(setCookie);
    if (match) {
      this.jsessionId = match[0];
    }
  }

  private captureViewState(body: string): void {
    const match = VIEW_STATE_PATTERN.exec(body);
    if (match) {
      this.viewState = match[1];
    }
  }
}
