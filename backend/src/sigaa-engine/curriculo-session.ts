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
    this.assertStatusOk(resposta, path);
    this.capture(resposta);
    if (!this.viewState) {
      throw new Error(`SIGAA page carried no ViewState: ${path}`);
    }
    return resposta.body;
  }

  /**
   * `opcoes.capturarViewState` (default `true`) controls whether this
   * response's ViewState (if any) replaces the session's current one.
   * Callers running several `postar`s concurrently against one shared
   * session (e.g. the per-component detail fetches in CurriculoService) must
   * pass `false` — otherwise two concurrent responses racing to update
   * `this.viewState` could hand a later postar the wrong conversation state.
   * This is currently moot for those leaf responses (they carry no
   * ViewState at all, so `capture` would be a no-op either way), but the
   * option makes that safe structurally rather than by accident of the
   * server's current behaviour.
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
