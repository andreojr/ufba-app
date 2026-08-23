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
 * `<form>` at all and does not advance the JSF conversation, so every
 * per-component detail fetch reuses the matrix's ViewState.
 *
 * That reuse does NOT make those fetches parallel-safe: resumo_curriculo.jsf
 * also keeps the component it is currently showing in the *session*, so
 * overlapping POSTs come back describing each other's components. See the
 * sequential loop (and the código check) in CurriculoService.resolverCurso.
 */
export class CurriculoPublicSession {
  private jsessionId: string | undefined;
  private viewState: string | undefined;

  constructor(private readonly http: SigaaHttpClient) {}

  async abrir(path: string): Promise<string> {
    const resposta = await this.http.request({ method: 'GET', path });
    this.assertStatusOk(resposta, path);
    this.capture(resposta);
    if (!this.viewState) {
      throw new Error(`SIGAA page carried no ViewState: ${path}`);
    }
    return resposta.body;
  }

  /**
   * `opcoes.capturarViewState` (default `true`) controls whether this
   * response's ViewState (if any) replaces the session's current one. Leaf
   * responses that must not advance the session's conversation state — the
   * per-component detail pages in CurriculoService — pass `false`. That is
   * currently moot for them (they carry no ViewState at all, so `capture`
   * would be a no-op either way), but it states the intent structurally
   * instead of relying on the server's current behaviour.
   */
  async postar(
    path: string,
    campos: Record<string, string>,
    opcoes: { capturarViewState?: boolean } = {},
  ): Promise<string> {
    const capturarViewState = opcoes.capturarViewState ?? true;
    if (!this.viewState) {
      throw new Error('CurriculoPublicSession.abrir must run before postar');
    }
    const resposta = await this.http.request({
      method: 'POST',
      path,
      cookie: this.jsessionId,
      body: { ...campos, 'javax.faces.ViewState': this.viewState },
    });
    this.assertStatusOk(resposta, path);
    this.capture(resposta, capturarViewState);
    return resposta.body;
  }

  private assertStatusOk(response: SigaaHttpResponse, path: string): void {
    if (response.status !== 200) {
      throw new Error(
        `Unexpected SIGAA response for ${path}: status ${response.status}`,
      );
    }
  }

  private capture(response: SigaaHttpResponse, capturarViewState = true): void {
    const cookie = (response.headers['set-cookie'] ?? '').match(
      JSESSIONID_PATTERN,
    );
    if (cookie) {
      this.jsessionId = cookie[0];
    }
    if (!capturarViewState) {
      return;
    }
    const viewState = response.body.match(VIEW_STATE_PATTERN);
    if (viewState) {
      this.viewState = viewState[1];
    }
  }
}
