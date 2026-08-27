import { Injectable, Logger } from '@nestjs/common';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
  SigaaCredentials,
  SigaaSession,
} from './session';
import { SigaaRateLimitedError } from './http-client';
import { Turma } from './parsers/turma';
import { parseAtestadoTurmas, PeriodoLetivo } from './parsers/atestado-turmas';
import { parseTurmaVirtualTokens } from './parsers/turma-virtual-tokens';
import { DiscentePerfil, parseDiscentePerfil } from './parsers/discente-perfil';
import {
  parseAtestadoMenuPostback,
  parseHistoricoMenuPostback,
} from './parsers/portal-menu';
import { inlineSameOriginAssets } from './inline-assets';
import { expandJawrStylesheets } from './jawr-styles';
import { fillScheduleGrid } from './atestado-grid';
import { SIGAA_BASE_URL } from './http-client';

const PORTAL_HOME_PATH = '/sigaa/portais/discente/discente.jsf';
const JAWR_LOADER_PATH = '/shared/jsBundles/jawr_loader.js';
const A4_PAGE_STYLE = '<style>@page{size:A4;margin:10mm}</style>';

export type SigaaSessionFactory = () => SigaaSession;

export interface SigaaWebSession {
  /** Raw `JSESSIONID=<value>` cookie pair — hand this to a real browser/WebView, not a fetch header. */
  sessionCookie: string;
  /** Where to point that browser once the cookie is set: the portal home, already authenticated. */
  targetUrl: string;
}

/**
 * O atestado de matrícula é a única fonte de horário desde que a turma virou
 * entidade compartilhada: só ele traz código e número da turma, e sem os dois
 * não há como ligar o aluno a uma turma que outros alunos também enxergam.
 * A "Minhas Turmas" da home continua parseável (parseTurmasHorario), mas só
 * para diagnóstico — devolvê-la aqui daria um horário que não se conecta a
 * nada.
 */
export class SigaaScheduleIndisponivelError extends Error {
  constructor(cause?: unknown) {
    super('Não foi possível sincronizar sua conta com o SIGAA.');
    this.name = 'SigaaScheduleIndisponivelError';
    this.cause = cause;
  }
}

@Injectable()
export class SigaaEngineService {
  private readonly logger = new Logger(SigaaEngineService.name);

  constructor(private readonly createSession: SigaaSessionFactory) {}

  /**
   * Logs in with the given credentials (never persisted by this method) and
   * returns the current term's turmas + translated schedule, read from the
   * atestado de matrícula rather than the portal home: only that document
   * carries the course code, the docente, and the official term dates (see
   * ATESTADO_MATRICULA_INVESTIGATION.md). The home is still fetched — it's
   * where the postback fields come from — so the student's identity box
   * (#agenda-docente) comes along for free, nullable fields and all.
   *
   * Uma turma sem código ou sem número vira `SigaaScheduleIndisponivelError`
   * (ver o comentário da classe) — mas um atestado que lê normalmente e
   * lista zero turmas não é esse caso: o aluno pode legitimamente não estar
   * matriculado em nada no período, e quem decide o que fazer com isso
   * (inclusive preservar um horário em cache) é o `ScheduleService`, como já
   * fazia antes desta task.
   */
  async fetchSchedule(credentials: SigaaCredentials): Promise<{
    turmas: Turma[];
    perfil: DiscentePerfil;
    periodoLetivo: PeriodoLetivo | null;
  }> {
    const session = this.createSession();
    await session.login(credentials);
    // A JSF postback is only valid against a view the server already rendered
    // for this session, so this GET is required either way.
    const portalHtml = await session.get(PORTAL_HOME_PATH);
    const perfil = parseDiscentePerfil(portalHtml);

    try {
      const { id, jscookAction } = parseAtestadoMenuPostback(portalHtml);
      const atestadoHtml = await session.postback(PORTAL_HOME_PATH, {
        'menu:form_menu_discente': 'menu:form_menu_discente',
        id,
        jscook_action: jscookAction,
      });
      const { turmas, periodoLetivo } = parseAtestadoTurmas(atestadoHtml);
      // portalHtml já foi lido acima (linha 82) pra pegar o perfil — o token
      // da Turma Virtual mora no mesmo documento, sem request extra. A chave
      // de junção é o nome, não o código: o link real da home não traz o
      // código do componente, só o nome (confirmado contra sigaa.ufba.br).
      const tokensPorNome = new Map(
        parseTurmaVirtualTokens(portalHtml).map((token) => [
          token.nome,
          token,
        ]),
      );
      const turmasComToken = turmas.map((turma) => {
        const token = tokensPorNome.get(turma.nome.trim());
        return {
          ...turma,
          frontEndIdTurma: token?.frontEndIdTurma ?? null,
          idTurmaSigaa: token?.idTurmaSigaa ?? null,
        };
      });
      // Código e número são a identidade compartilhada da turma. Sem eles o
      // horário até renderizaria, mas não se conectaria a turma nenhuma — é
      // o mesmo motivo pelo qual a home do portal deixou de valer. Zero
      // turmas não entra aqui: um atestado lido com sucesso que lista uma
      // grade vazia é uma resposta válida, não uma falha de sincronização.
      if (turmasComToken.some((turma) => !turma.codigo || !turma.numero)) {
        throw new SigaaScheduleIndisponivelError();
      }
      return { turmas: turmasComToken, perfil, periodoLetivo };
    } catch (error) {
      // Erros de domínio do SIGAA já sabem o próprio status (401 de sessão
      // expirada, 429 de rate limit) e o cliente já sabe reagir a cada um —
      // embrulhar tudo em SigaaScheduleIndisponivelError (503) escondia um
      // rate limit ou uma sessão expirada atrás de "SIGAA indisponível" e
      // pulava o tratamento de credencial inválida do cliente.
      if (
        error instanceof SigaaScheduleIndisponivelError ||
        error instanceof SigaaRateLimitedError ||
        error instanceof SigaaSessionExpiredError ||
        error instanceof SigaaInvalidCredentialsError ||
        error instanceof SigaaCredentialsRequiredError
      ) {
        throw error;
      }
      this.logger.warn(
        'Could not read the schedule off the atestado de matrícula',
        error instanceof Error ? error.stack : String(error),
      );
      throw new SigaaScheduleIndisponivelError(error);
    }
  }

  /**
   * Logs in with the given credentials (never persisted by this method) and returns
   * the resulting SIGAA session cookie so a client can open the *actual* SIGAA site
   * already authenticated — e.g. a mobile WebView with the cookie injected into its
   * own cookie store. This is distinct from fetchSchedule/get()/postback(): those
   * drive navigation ourselves one HTTP request at a time, but a WebView hands
   * control to a real browser engine, so the cookie has to live in a proper cookie
   * jar rather than a one-off request header (see the SIGAA investigation spike).
   */
  async createWebSession(
    credentials: SigaaCredentials,
  ): Promise<SigaaWebSession> {
    const session = this.createSession();
    await session.login(credentials);

    const sessionCookie = session.sessionCookie;
    if (!sessionCookie) {
      throw new Error(
        'SIGAA login succeeded without yielding a session cookie',
      );
    }

    return {
      sessionCookie,
      targetUrl: `${SIGAA_BASE_URL}${PORTAL_HOME_PATH}`,
    };
  }

  /**
   * Logs in and returns the transcript ("Histórico Escolar") as PDF bytes,
   * via the classic portal's "Ensino > Emitir Histórico" menu item: a
   * JSCookMenu postback against discente.jsf whose 200 response *is* the PDF.
   * The mobile touch flow this replaced (postback → 302 → gerarHistorico)
   * only works for some vínculos — for others gerarHistorico streams zero
   * bytes — while the classic flow is the one every account exercises through
   * the real desktop site (see HISTORICO_PDF_INVESTIGATION.md).
   */
  async fetchHistorico(credentials: SigaaCredentials): Promise<Buffer> {
    const session = this.createSession();
    await session.login(credentials);
    // A JSF postback is only valid against a view the server already rendered
    // for this session — this GET both renders it and hands us the HTML the
    // menu postback's per-deploy fields are scraped from.
    const portalHtml = await session.get(PORTAL_HOME_PATH);
    const { id, jscookAction } = parseHistoricoMenuPostback(portalHtml);
    const pdf = await session.postbackBinary(PORTAL_HOME_PATH, {
      'menu:form_menu_discente': 'menu:form_menu_discente',
      id,
      jscook_action: jscookAction,
    });

    // SIGAA answers failures as a 200 HTML page (session lost, no vínculo,
    // etc.) — never hand that to a client as if it were the document.
    if (!pdf.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
      throw new Error(
        `Expected the histórico postback to answer with a PDF, got ${pdf.length} bytes starting with ${JSON.stringify(
          pdf.subarray(0, 40).toString('latin1'),
        )}`,
      );
    }
    return pdf;
  }

  /**
   * Logs in and returns the atestado de matrícula ("Emitir Atestado de
   * Matrícula") as a *self-contained HTML document* — SIGAA serves this one as a
   * print-ready page (window.print() on load), not a PDF byte stream like
   * histórico. Same classic JSCookMenu postback, but its 200 answer is HTML that
   * references CSS/images SIGAA serves behind the session; we inline those (and
   * strip scripts) so the client can render it to a PDF fully offline — on the
   * device via expo-print (see ATESTADO_MATRICULA_INVESTIGATION.md).
   */
  async fetchAtestado(credentials: SigaaCredentials): Promise<string> {
    const session = this.createSession();
    await session.login(credentials);
    const portalHtml = await session.get(PORTAL_HOME_PATH);
    const { id, jscookAction } = parseAtestadoMenuPostback(portalHtml);
    const html = await session.postback(PORTAL_HOME_PATH, {
      'menu:form_menu_discente': 'menu:form_menu_discente',
      id,
      jscook_action: jscookAction,
    });

    // The print layout (ufrn_print.css: hides the "Voltar"/"Imprimir" nav,
    // centers the page) is pulled at runtime by JAWR.loader.style() in a script
    // we're about to strip. Resolve those calls to real <link>s off the loader's
    // per-deploy bundle map so the inliner embeds them (applied unconditionally,
    // so the print layout holds however the device renders the PDF). Best-effort:
    // if the loader can't be fetched, we still return a styled — just not
    // print-tuned — document.
    const loader = await session.getAsset(JAWR_LOADER_PATH);
    const withPrintStyles = loader
      ? expandJawrStylesheets(html, loader.bytes.toString('latin1'))
      : html;

    // The "Tabela de Horários" grid is filled in by a script (one
    // getElementById(...).innerHTML per occupied cell) that we're about to
    // strip; apply those assignments now so the grid isn't printed all "---".
    const withGrid = fillScheduleGrid(withPrintStyles);

    // Force A4 (SIGAA's own page size): the device's expo-print defaults to US
    // Letter, which reflows the document to different proportions than the
    // official desktop print. @page is the only page-size lever available from
    // the HTML, and every renderer honors it.
    const paged = withGrid.includes('<head>')
      ? withGrid.replace('<head>', `<head>${A4_PAGE_STYLE}`)
      : A4_PAGE_STYLE + withGrid;

    return inlineSameOriginAssets(paged, (path) => session.getAsset(path));
  }
}
