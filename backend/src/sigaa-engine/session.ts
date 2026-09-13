export interface SigaaHttpRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, string>;
  cookie?: string;
  /**
   * A página de onde este POST partiu, pro cabeçalho Referer. Só importa em
   * POST: um formulário enviado sem Referer do próprio site é o que uma regra
   * de borda descarta primeiro. Ausente, o cliente usa o próprio `path` (que é
   * o que um postback JSF faria de qualquer jeito).
   */
  referer?: string;
}

export interface SigaaHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Raw response bytes, for binary resources (e.g. a PDF) the ISO-8859-1-decoded `body` would corrupt. */
  bodyBuffer?: Buffer;
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

/**
 * O login não passou, mas o SIGAA *não* disse que usuário/senha estavam errados:
 * voltou o formulário de login mudo, um redirect pra outro lugar, um bloqueio de
 * WAF, uma página de manutenção. Antes tudo isso virava
 * SigaaInvalidCredentialsError (401 + SIGAA_INVALID_CREDENTIALS), o que fazia o
 * app acusar a senha do aluno — e marcar a senha guardada como rejeitada —
 * quando o problema era do outro lado. A mensagem carrega uma impressão digital
 * da resposta (status, location, título) justamente pra dar pra diagnosticar
 * pelo log sem precisar de credencial de ninguém.
 */
export class SigaaLoginIndisponivelError extends Error {
  constructor(fingerprint: string) {
    super(`SIGAA did not complete the login: ${fingerprint}`);
    this.name = 'SigaaLoginIndisponivelError';
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
const LOGIN_FORM_BLOCK_PATTERN = /<form[^>]*name="loginForm"[\s\S]*?<\/form>/i;
const FORM_ACTION_PATTERN = /<form[^>]*name="loginForm"[^>]*action="([^"]*)"/i;
const INPUT_PATTERN = /<input\b[^>]*>/gi;
const INPUT_ATTR_PATTERN = (attr: string) =>
  new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, 'i');

/**
 * Os textos com que o SIGAA diz que o problema é de fato a credencial. Só eles
 * autorizam acusar a senha do aluno — o formulário de login voltando calado não.
 */
const CREDENTIAL_REJECTION_MARKERS = [
  'senha inválidos',
  'senha inválida',
  'usuário e/ou senha',
];

function isLoginFormResponse(response: SigaaHttpResponse): boolean {
  return (
    response.status === 200 &&
    (response.body.includes(LOGIN_FORM_MARKER) ||
      response.body.includes(INVALID_CREDENTIALS_MARKER))
  );
}

function saysCredentialsAreWrong(body: string): boolean {
  const lowered = body.toLowerCase();
  return CREDENTIAL_REJECTION_MARKERS.some((marker) =>
    lowered.includes(marker),
  );
}

/**
 * Os campos ocultos do formulário de login, lidos da própria página em vez de
 * chutados. O SIGAA é JSF: a lista de hidden inputs do formulário muda quando a
 * instalação é atualizada (um token novo, um campo renomeado), e um POST que não
 * carrega todos eles é descartado — a resposta é o formulário de login de volta,
 * indistinguível de uma senha errada. Postar o que a página pediu é o que faz
 * esse acoplamento parar de quebrar sozinho.
 */
export function hiddenLoginFormFields(html: string): Record<string, string> {
  const form = LOGIN_FORM_BLOCK_PATTERN.exec(html)?.[0];
  if (!form) return {};

  const fields: Record<string, string> = {};
  for (const input of form.match(INPUT_PATTERN) ?? []) {
    const name = INPUT_ATTR_PATTERN('name').exec(input)?.[1];
    if (!name) continue;
    const type = (
      INPUT_ATTR_PATTERN('type').exec(input)?.[1] ?? ''
    ).toLowerCase();
    // Os campos visíveis (o próprio usuário/senha) e os botões nós preenchemos
    // ou descartamos por conta própria — aqui só interessa o que é estado.
    if (type && type !== 'hidden') continue;
    fields[name] = INPUT_ATTR_PATTERN('value').exec(input)?.[1] ?? '';
  }
  return fields;
}

/**
 * O `action` do formulário, quando é um caminho da própria instalação. Mesmo
 * motivo dos campos ocultos: se o SIGAA mudar o endpoint de autenticação, o
 * caminho certo está escrito na página que acabamos de buscar.
 */
export function loginFormAction(html: string): string | undefined {
  const action = FORM_ACTION_PATTERN.exec(html)?.[1];
  if (!action) return undefined;
  if (action.startsWith('/')) return action;
  try {
    const url = new URL(action);
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

/** Um resumo da resposta que dá pra logar sem vazar nada do aluno. */
function fingerprint(response: SigaaHttpResponse): string {
  const title = /<title>([\s\S]{0,120}?)<\/title>/i
    .exec(response.body)?.[1]
    ?.trim()
    .replace(/\s+/g, ' ');
  const parts = [
    `status ${response.status}`,
    response.headers.location
      ? `location ${response.headers.location}`
      : undefined,
    title ? `title "${title}"` : undefined,
    response.body.includes(LOGIN_FORM_MARKER)
      ? 'login form returned'
      : `body ${response.body.length} bytes`,
  ];
  return parts.filter(Boolean).join(', ');
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
      path: loginFormAction(initial.body) ?? '/sigaa/logar.do?dispatch=logOn',
      cookie: this.jsessionId,
      referer: '/sigaa/verTelaLogin.do',
      body: {
        width: '1920',
        height: '1080',
        urlRedirect: '',
        subsistemaRedirect: '',
        acao: '',
        acessibilidade: '',
        // Qualquer campo oculto que a página de login tenha passado a exigir
        // (um token novo, um campo renomeado) entra aqui por cima dos valores
        // fixos acima, e o usuário/senha entram por cima de tudo.
        ...hiddenLoginFormFields(initial.body),
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

    // Só o SIGAA dizendo, com todas as letras, que usuário/senha não prestam é
    // credencial inválida. O formulário voltando calado, um redirect pra outro
    // lugar, um bloqueio de borda: nada disso é culpa da senha do aluno, e
    // tratar como se fosse era o que fazia o app pedir pra ele trocar uma senha
    // que estava certa (e marcar a guardada como rejeitada).
    if (saysCredentialsAreWrong(response.body)) {
      throw new SigaaInvalidCredentialsError();
    }

    throw new SigaaLoginIndisponivelError(fingerprint(response));
  }

  /**
   * The raw `JSESSIONID=<value>` cookie pair for the current logged-in session, or
   * undefined before login. Exists so callers that need to hand the session off to a
   * real browser context (e.g. a mobile WebView opening the actual SIGAA site) can
   * read it out, instead of always driving navigation through get()/postback().
   */
  get sessionCookie(): string | undefined {
    return this.jsessionId;
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

  /**
   * For postbacks whose result isn't a page but binary bytes, bypassing the
   * ISO-8859-1 text decoding `get`/`postback` rely on (which would corrupt
   * them). Handles both shapes SIGAA uses: the classic portal answers the
   * postback with the bytes directly in the 200 body (e.g. "Emitir Histórico"
   * on discente.jsf), while the mobile touch flow hands back a 302 to a
   * dedicated generating endpoint that is then fetched.
   */
  async postbackBinary(
    path: string,
    fields: Record<string, string>,
  ): Promise<Buffer> {
    if (!this.jsessionId) {
      throw new Error(
        'SigaaSession.login must succeed before making authenticated requests',
      );
    }

    const response = await this.http.request({
      method: 'POST',
      path,
      cookie: this.jsessionId,
      body: { ...fields, 'javax.faces.ViewState': this.viewState ?? '' },
    });
    this.captureCookie(response);

    if (response.status === 302 && response.headers.location) {
      const location = new URL(response.headers.location);
      const binary = await this.http.request({
        method: 'GET',
        path: `${location.pathname}${location.search}`,
        cookie: this.jsessionId,
      });
      this.captureCookie(binary);

      if (!binary.bodyBuffer) {
        throw new Error('Expected a binary response body');
      }
      return binary.bodyBuffer;
    }

    if (response.status === 200 && response.bodyBuffer) {
      return response.bodyBuffer;
    }

    throw new Error(
      `Expected the postback to yield a binary body (directly or via redirect), got status ${response.status}`,
    );
  }

  /**
   * Fetches a same-origin asset (CSS, image, ...) with the session cookie,
   * returning its raw bytes and content-type, or null when it isn't a 200 with
   * a body. Deliberately skips the login-form/relogin and ViewState handling of
   * `get`/`postback`: an asset is a static resource, not a JSF view, so there's
   * no ViewState to capture and a 404 should surface as "skip this asset", not
   * as a session-expired retry.
   */
  async getAsset(
    path: string,
  ): Promise<{ contentType: string; bytes: Buffer } | null> {
    if (!this.jsessionId) {
      throw new Error(
        'SigaaSession.login must succeed before making authenticated requests',
      );
    }

    const response = await this.http.request({
      method: 'GET',
      path,
      cookie: this.jsessionId,
    });
    this.captureCookie(response);

    if (response.status !== 200 || !response.bodyBuffer) {
      return null;
    }

    return {
      contentType: response.headers['content-type'] ?? '',
      bytes: response.bodyBuffer,
    };
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
