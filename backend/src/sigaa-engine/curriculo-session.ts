import type { SigaaHttpClient, SigaaHttpResponse } from './session';

const VIEW_STATE_PATTERN = /name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/;
const JSESSIONID_PATTERN = /JSESSIONID=[^;]+/;

/**
 * A generalised, curriculo-specific counterpart to the (professores feature's)
 * PublicSigaaSession: that class is hardcoded to a single search endpoint's
 * path and body shape, while resolving a curriculum needs several distinct
 * pages in sequence (curriculo.jsf → resumo_curriculo.jsf for the matrix →
 * resumo_curriculo.jsf again per component). A new small class, not a shared
 * base — same call the professores design itself made about SigaaSession:
 * extract a common base only once a third distinct need shows up.
 *
 * `capture` silently keeps the previous ViewState when a response carries
 * none — measured against the real component-detail page, which renders no
 * `<form>` at all and does not advance the JSF conversation. That is what
 * makes the per-component detail fetches in CurriculoService safe to run in
 * parallel while reusing one ViewState.
 */
export class CurriculoPublicSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;

  constructor(private readonly http: SigaaHttpClient) {}

  async abrir(path: string): Promise<string> {
    const resposta = await this.http.request({ method: 'GET', path });
    this.capture(resposta);
    if (!this.viewState) {
      throw new Error(`SIGAA page carried no ViewState: ${path}`);
    }
    return resposta.body;
  }

  async postar(path: string, campos: Record<string, string>): Promise<string> {
    if (!this.viewState) {
      throw new Error('CurriculoPublicSession.abrir must run before postar');
    }
    const resposta = await this.http.request({
      method: 'POST',
      path,
      cookie: this.jsessionId,
      body: { ...campos, 'javax.faces.ViewState': this.viewState },
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
