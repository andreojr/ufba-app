import { normalizarNomeDocente } from './docente-nome';
import type { SigaaHttpClient, SigaaHttpResponse } from './session';

const BUSCA_PATH = '/sigaa/public/docente/busca_docentes.jsf';
const VIEW_STATE_PATTERN = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID_PATTERN = /JSESSIONID=[^;]+/;

/**
 * SIGAA's public docente portal needs a JSF session for the *search* only — a
 * cold POST answers 302. The profile pages themselves are stateless GETs (see
 * getPaginaPublica below).
 *
 * Deliberately separate from SigaaSession rather than a mode of it: that class
 * exists to manage login, relogin and credentials, none of which apply here,
 * and it is the path every authenticated feature depends on.
 */
export class PublicSigaaSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;

  constructor(private readonly http: SigaaHttpClient) {}

  async iniciar(): Promise<void> {
    const inicial = await this.http.request({
      method: 'GET',
      path: BUSCA_PATH,
    });
    this.capture(inicial);
    if (!this.viewState) {
      throw new Error('SIGAA public search page carried no ViewState');
    }
  }

  async buscar(nome: string): Promise<string> {
    if (!this.viewState) {
      throw new Error('PublicSigaaSession.iniciar must run before buscar');
    }

    const resposta = await this.http.request({
      method: 'POST',
      path: BUSCA_PATH,
      cookie: this.jsessionId,
      body: {
        form: 'form',
        // ASCII only: SIGAA reads this body as ISO-8859-1 and a UTF-8 accent
        // comes back as a silent 200 with no table and no error message.
        'form:nome': normalizarNomeDocente(nome),
        'form:departamento': '0',
        'form:buscar': 'Buscar',
        'javax.faces.ViewState': this.viewState,
      },
    });
    this.capture(resposta);
    return resposta.body;
  }

  private capture(response: SigaaHttpResponse): void {
    const cookie = (response.headers['set-cookie'] ?? '').match(
      JSESSIONID_PATTERN,
    );
    if (cookie) {
      this.jsessionId = cookie[0];
    }
    const viewState = response.body.match(VIEW_STATE_PATTERN);
    if (viewState) {
      this.viewState = viewState[1];
    }
  }
}

/**
 * A stateless public GET. An unknown or missing siape answers 302 (not 404), so
 * a redirect means "no such docente" and is reported as null; anything else
 * unexpected throws, because the caller must not record a false "no public
 * record" for what is really an outage.
 */
export async function getPaginaPublica(
  http: SigaaHttpClient,
  path: string,
): Promise<string | null> {
  const response = await http.request({ method: 'GET', path });
  if (response.status === 302) {
    return null;
  }
  if (response.status !== 200) {
    throw new Error(`Unexpected status ${response.status} for ${path}`);
  }
  return response.body;
}
