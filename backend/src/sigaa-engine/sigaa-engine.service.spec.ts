import { Logger } from '@nestjs/common';
import {
  SigaaEngineService,
  SigaaScheduleIndisponivelError,
} from './sigaa-engine.service';
import { SigaaInvalidCredentialsError, SigaaSession } from './session';

const PORTAL_HTML = `
  <div id="agenda-docente">
    <table>
      <tbody>
        <tr><td class="col1">Matrícula:</td><td><b>223116037</b></td></tr>
        <tr><td class="col1">Curso:</td><td><b>ENGENHARIA DE COMPUTAÇÃO</b></td></tr>
        <tr><td class="col1">Entrada:</td><td><b>2022.1</b></td></tr>
      </tbody>
    </table>
  </div>
  <table style="margin-top: 1%;">
    <tbody>
      <tr><td colspan="5">2026.2</td></tr>
      <tr class="odd">
        <td class="descricao"><span>ENG999 - LABORATÓRIO INTEGRADO III-A</span></td>
        <td class="info">ENG (ENG)</td>
        <td class="info"><center>2N34 (19/08/2026 - 19/12/2026)</center></td>
      </tr>
    </tbody>
  </table>
`;

function fakeSession(
  overrides: Partial<{
    login: jest.Mock;
    get: jest.Mock;
    postback: jest.Mock;
    postbackBinary: jest.Mock;
    getAsset: jest.Mock;
    sessionCookie: string | undefined;
  }> = {},
) {
  return {
    login: overrides.login ?? jest.fn().mockResolvedValue(undefined),
    get: overrides.get ?? jest.fn().mockResolvedValue(PORTAL_HTML),
    postback: overrides.postback ?? jest.fn(),
    postbackBinary:
      overrides.postbackBinary ??
      jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
    getAsset: overrides.getAsset ?? jest.fn().mockResolvedValue(null),
    sessionCookie:
      'sessionCookie' in overrides
        ? overrides.sessionCookie
        : 'JSESSIONID=abc123.sigaapl06',
  };
}

// The portal home as fetchSchedule now needs it: the perfil box and the
// "Minhas Turmas" fallback table, plus the JSCookMenu the atestado postback
// fields are scraped from.
const HOME_WITH_ATESTADO_MENU = `
  ${PORTAL_HTML}
  <form id="menu:form_menu_discente" name="menu:form_menu_discente" method="post" action="/sigaa/portais/discente/discente.jsf">
  <input type="hidden" name="id" value="115447">
  <script type="text/javascript">var menu_form_menu_discente_discente_menu =
  [[null, 'Emitir Atestado de Matr&#237;cula', 'menu_form_menu_discente_j_id_jsp_1_menu:A]#{ portalDiscente.atestadoMatricula }', 'menu:form_menu_discente', null]];</script>
  </form>
`;

// What the atestado postback answers with, trimmed to the two tables the
// schedule is read from. Note the "MATA58" code and the docente — neither
// exists anywhere on the portal home.
const ATESTADO_SCHEDULE_HTML = `
  <table id="identificacao">
    <tr><td>Período Letivo:</td><td><strong>2026.2</strong> (19/08/2026 à 19/12/2026)</td></tr>
  </table>
  <table id="matriculas">
    <tbody>
      <tr>
        <td class="codigo">MATA58</td>
        <td><span class="componente">SISTEMAS OPERACIONAIS</span>
            <span class="docente">BEATRIZ NUNES CAMPELO</span>
            <span class="local"><b>Local:</b> ENG (ENG)</span></td>
        <td class="turma">02</td>
        <td class="status">MATRICULADO</td>
        <td class="horario">2N34 (19/08/2026 - 19/12/2026)</td>
      </tr>
      <tr>
        <td class="codigo">ECOB40</td>
        <td><span class="componente">INTRODUÇÃO À ECONOMIA I</span>
            <span class="local"><b>Local:</b> PAC (PAC)</span></td>
        <td class="turma">05</td>
        <td class="status">INDEFERIDO</td>
        <td class="horario">6N1234 (19/08/2026 - 19/12/2026)</td>
      </tr>
    </tbody>
  </table>
`;

describe('SigaaEngineService.fetchSchedule', () => {
  // Falling back is a warned-about event, so let the tests that trigger it
  // assert the warning instead of letting Nest print it over the test output.
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function scheduleSession(overrides: Parameters<typeof fakeSession>[0] = {}) {
    return fakeSession({
      get: jest.fn().mockResolvedValue(HOME_WITH_ATESTADO_MENU),
      postback: jest.fn().mockResolvedValue(ATESTADO_SCHEDULE_HTML),
      ...overrides,
    });
  }

  it('reads the schedule off the atestado de matrícula, which carries the course code and docente', async () => {
    const session = scheduleSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const { turmas } = await service.fetchSchedule({
      login: 'user',
      senha: 'pass',
    });

    expect(session.postback).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
      {
        'menu:form_menu_discente': 'menu:form_menu_discente',
        id: '115447',
        jscook_action:
          'menu_form_menu_discente_j_id_jsp_1_menu:A]#{ portalDiscente.atestadoMatricula }',
      },
    );
    expect(turmas).toHaveLength(1);
    expect(turmas[0].codigo).toBe('MATA58');
    expect(turmas[0].docente).toBe('BEATRIZ NUNES CAMPELO');
  });

  it('returns the periodo letivo the atestado states', async () => {
    const session = scheduleSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const { periodoLetivo } = await service.fetchSchedule({
      login: 'user',
      senha: 'pass',
    });

    expect(periodoLetivo).toEqual({
      semestre: '2026.2',
      inicio: '2026-08-19',
      fim: '2026-12-19',
    });
  });

  it('still reads the perfil off the portal home (the atestado has no período de ingresso)', async () => {
    const session = scheduleSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const { perfil } = await service.fetchSchedule({
      login: 'user',
      senha: 'pass',
    });

    expect(session.get).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
    );
    expect(perfil).toEqual({
      matricula: '223116037',
      curso: 'ENGENHARIA DE COMPUTAÇÃO',
      periodoIngresso: '2022.1',
    });
  });

  it('fails instead of falling back to the portal home when the atestado postback fails', async () => {
    // O atestado é a única fonte com código e número de turma (ver o
    // comentário em SigaaScheduleIndisponivelError) — perder o postback não
    // pode mais degradar para a home, tem que falhar.
    const session = scheduleSession({
      postback: jest.fn().mockRejectedValue(new Error('postback exploded')),
    });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchSchedule({ login: 'user', senha: 'pass' }),
    ).rejects.toBeInstanceOf(SigaaScheduleIndisponivelError);
    expect(warn).toHaveBeenCalledWith(
      'Could not read the schedule off the atestado de matrícula',
      expect.any(String),
    );
  });

  it('fails instead of falling back to the portal home when the atestado menu item is absent', async () => {
    const session = fakeSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchSchedule({ login: 'user', senha: 'pass' }),
    ).rejects.toBeInstanceOf(SigaaScheduleIndisponivelError);
  });

  it('falha quando uma turma vem sem código ou sem número', async () => {
    // Sem os dois, não há como ligar o aluno a uma turma compartilhada —
    // mesmo com um horário perfeitamente parseável.
    const session = scheduleSession({
      postback: jest
        .fn()
        .mockResolvedValue(
          ATESTADO_SCHEDULE_HTML.replace(
            /<td class="turma">[^<]*<\/td>/g,
            '<td class="turma"></td>',
          ),
        ),
    });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchSchedule({ login: 'user', senha: 'pass' }),
    ).rejects.toBeInstanceOf(SigaaScheduleIndisponivelError);
  });

  it('resolve com turmas vazias quando o atestado lê normalmente mas não lista turma nenhuma', async () => {
    // Zero turmas não é falha de sincronização: o aluno pode legitimamente
    // não estar matriculado em nada no período. Quem decide o que fazer com
    // isso (inclusive preservar um horário em cache) é o ScheduleService.
    const session = scheduleSession({
      postback: jest.fn().mockResolvedValue('<html><body></body></html>'),
    });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const { turmas, periodoLetivo } = await service.fetchSchedule({
      login: 'user',
      senha: 'pass',
    });

    expect(turmas).toEqual([]);
    expect(periodoLetivo).toBeNull();
  });

  it('propagates SigaaInvalidCredentialsError without attempting to fetch the portal', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new SigaaInvalidCredentialsError());
    const session = fakeSession({ login });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchSchedule({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
    expect(session.get).not.toHaveBeenCalled();
  });

  it('creates a fresh session per call (credentials are never reused across calls)', async () => {
    const sessionFactory = jest.fn(
      () => scheduleSession() as unknown as SigaaSession,
    );
    const service = new SigaaEngineService(sessionFactory);

    await service.fetchSchedule({ login: 'user', senha: 'pass' });
    await service.fetchSchedule({ login: 'user', senha: 'pass' });

    expect(sessionFactory).toHaveBeenCalledTimes(2);
  });
});

describe('SigaaEngineService.createWebSession', () => {
  it('logs in and returns the session cookie plus the portal home URL', async () => {
    const session = fakeSession({
      sessionCookie: 'JSESSIONID=abc123.sigaapl06',
    });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const result = await service.createWebSession({
      login: 'user',
      senha: 'pass',
    });

    expect(session.login).toHaveBeenCalledWith({
      login: 'user',
      senha: 'pass',
    });
    expect(result).toEqual({
      sessionCookie: 'JSESSIONID=abc123.sigaapl06',
      targetUrl: 'https://sigaa.ufba.br/sigaa/portais/discente/discente.jsf',
    });
  });

  it('propagates SigaaInvalidCredentialsError without reading the session cookie', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new SigaaInvalidCredentialsError());
    const session = fakeSession({ login });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.createWebSession({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
  });

  it('throws if login succeeds but somehow yields no session cookie', async () => {
    const session = fakeSession({ sessionCookie: undefined });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.createWebSession({ login: 'user', senha: 'pass' }),
    ).rejects.toThrow(/session cookie/);
  });
});

// Trimmed-down shape of the classic portal home's JSCookMenu form — the two
// values fetchHistorico scrapes out of it (hidden id + jscook_action token)
// vary per SIGAA deploy, hence parsed rather than hardcoded.
const PORTAL_MENU_HTML = `
  <form id="menu:form_menu_discente" name="menu:form_menu_discente" method="post" action="/sigaa/portais/discente/discente.jsf">
  <input type="hidden" name="menu:form_menu_discente" value="menu:form_menu_discente">
  <input type="hidden" name="id" value="475404">
  <input type="hidden" name="jscook_action">
  <script type="text/javascript">var menu_form_menu_discente_discente_menu =
  [[null, 'Emitir Hist&#243;rico', 'menu_form_menu_discente_discente_menu:A]#{ portalDiscente.historico }', 'menu:form_menu_discente', null]];</script>
  </form>
`;

describe('SigaaEngineService.fetchHistorico', () => {
  it('logs in, scrapes the classic menu postback off the portal home, and returns the PDF bytes', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 fake');
    const postbackBinary = jest.fn().mockResolvedValue(pdfBuffer);
    const get = jest.fn().mockResolvedValue(PORTAL_MENU_HTML);
    const session = fakeSession({ get, postbackBinary });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const result = await service.fetchHistorico({
      login: 'user',
      senha: 'pass',
    });

    expect(session.login).toHaveBeenCalledWith({
      login: 'user',
      senha: 'pass',
    });
    // The GET renders the JSF view (postbacks against never-rendered views
    // silently fall back to the last valid page) AND supplies the HTML the
    // menu postback fields are scraped from.
    expect(get).toHaveBeenCalledWith('/sigaa/portais/discente/discente.jsf');
    expect(postbackBinary).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
      {
        'menu:form_menu_discente': 'menu:form_menu_discente',
        id: '475404',
        jscook_action:
          'menu_form_menu_discente_discente_menu:A]#{ portalDiscente.historico }',
      },
    );
    expect(result).toBe(pdfBuffer);
  });

  it('throws (instead of returning garbage bytes) when the postback answers with something that is not a PDF', async () => {
    const postbackBinary = jest
      .fn()
      .mockResolvedValue(Buffer.from('<html>session lost, have a page</html>'));
    const get = jest.fn().mockResolvedValue(PORTAL_MENU_HTML);
    const session = fakeSession({ get, postbackBinary });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchHistorico({ login: 'user', senha: 'pass' }),
    ).rejects.toThrow(/PDF/);
  });

  it('propagates SigaaInvalidCredentialsError without attempting the postback', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new SigaaInvalidCredentialsError());
    const postbackBinary = jest.fn();
    const session = fakeSession({ login, postbackBinary });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchHistorico({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
    expect(postbackBinary).not.toHaveBeenCalled();
  });
});

// The atestado menu item lives in the same JSCookMenu; its action expression
// is portalDiscente.atestadoMatricula (distinct from portalDiscente.historico).
const ATESTADO_MENU_HTML = `
  <form id="menu:form_menu_discente" name="menu:form_menu_discente" method="post" action="/sigaa/portais/discente/discente.jsf">
  <input type="hidden" name="id" value="115447">
  <script type="text/javascript">var menu_form_menu_discente_discente_menu =
  [[null, 'Emitir Atestado de Matr&#237;cula', 'menu_form_menu_discente_j_id_jsp_1_menu:A]#{ portalDiscente.atestadoMatricula }', 'menu:form_menu_discente', null]];</script>
  </form>
`;

// What the atestado postback answers with: a print-ready HTML page that depends
// on same-origin CSS/images, a window.print() script, and — crucially — the
// print stylesheet loaded at runtime via JAWR.loader.style() (not a static
// <link>), which hides the non-printable nav.
const ATESTADO_PRINT_HTML = `<html><head>
  <link rel="stylesheet" href="/sigaa/css/atestado_matricula.css" type="text/css" />
  <script type="text/javascript">window.print();JAWR.loader.style('/css/ufrn_print.css', 'print');</script>
  </head><body>
  <img src="/shared/img/instituicao/ufrn.gif" height="40"/>
  <table id="matriculas"><tr><td>MATRICULADO</td></tr></table>
  <table id="horario"><tr><td><span id="2_11">---</span></td></tr></table>
  <td class="naoImprimir"><a href="#">Imprimir</a></td>
  <script type="text/javascript">
    var elem = document.getElementById('2_11');
    if (elem) elem.innerHTML = 'ENGG64';
  </script>
  </body></html>`;

// Minimal jawr_loader.js exposing the bundle map for /css/ufrn_print.css.
const JAWR_LOADER_JS = `var b=[r("/css/ufrn_print.css","/gzip_48504048/",["/css/ufrn_print.css"])];`;
const UFRN_PRINT_CSS_URL =
  '/shared/cssBundles/gzip_48504048/css/ufrn_print.css';

describe('SigaaEngineService.fetchAtestado', () => {
  function atestadoSession() {
    const get = jest.fn().mockResolvedValue(ATESTADO_MENU_HTML);
    const postback = jest.fn().mockResolvedValue(ATESTADO_PRINT_HTML);
    const getAsset = jest.fn().mockImplementation((path: string) => {
      if (path === '/shared/jsBundles/jawr_loader.js') {
        return Promise.resolve({
          contentType: 'application/javascript',
          bytes: Buffer.from(JAWR_LOADER_JS),
        });
      }
      if (path === UFRN_PRINT_CSS_URL) {
        return Promise.resolve({
          contentType: 'text/css',
          bytes: Buffer.from('.naoImprimir,.voltar{display:none}'),
        });
      }
      if (path === '/sigaa/css/atestado_matricula.css') {
        return Promise.resolve({
          contentType: 'text/css',
          bytes: Buffer.from('.matricula{color:#000}'),
        });
      }
      if (path === '/shared/img/instituicao/ufrn.gif') {
        return Promise.resolve({
          contentType: 'image/gif',
          bytes: Buffer.from([0x47, 0x49, 0x46]),
        });
      }
      return Promise.resolve(null);
    });
    return fakeSession({ get, postback, getAsset });
  }

  it('logs in, scrapes the atestado menu postback, and posts the atestadoMatricula action', async () => {
    const session = atestadoSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await service.fetchAtestado({ login: 'user', senha: 'pass' });

    expect(session.login).toHaveBeenCalledWith({
      login: 'user',
      senha: 'pass',
    });
    expect(session.get).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
    );
    expect(session.postback).toHaveBeenCalledWith(
      '/sigaa/portais/discente/discente.jsf',
      {
        'menu:form_menu_discente': 'menu:form_menu_discente',
        id: '115447',
        jscook_action:
          'menu_form_menu_discente_j_id_jsp_1_menu:A]#{ portalDiscente.atestadoMatricula }',
      },
    );
  });

  it('returns a self-contained HTML document: assets inlined, scripts stripped', async () => {
    const session = atestadoSession();
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    const html = await service.fetchAtestado({ login: 'user', senha: 'pass' });

    expect(html).toContain('MATRICULADO');
    // CSS inlined as <style>, no external <link> or <script> left to fail offline
    expect(html).toContain('<style>.matricula{color:#000}</style>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    // The institution crest becomes a base64 data URI
    expect(html).toContain('src="data:image/gif;base64,');
    // The JAWR-loaded print stylesheet is resolved and inlined unconditionally
    // (no media gate) so the "Voltar"/"Imprimir" nav is hidden regardless of how
    // the device renders the PDF.
    expect(html).toContain('<style>.naoImprimir,.voltar{display:none}</style>');
    // A4 is forced so the device (expo-print defaults to US Letter) matches
    // SIGAA's own page size.
    expect(html).toContain('@page{size:A4');
    // The "Tabela de Horários" grid cell is filled from the (stripped) script,
    // not left as its "---" placeholder.
    expect(html).toContain('<span id="2_11">ENGG64</span>');
  });

  it('propagates SigaaInvalidCredentialsError without attempting the postback', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new SigaaInvalidCredentialsError());
    const postback = jest.fn();
    const session = fakeSession({ login, postback });
    const service = new SigaaEngineService(
      () => session as unknown as SigaaSession,
    );

    await expect(
      service.fetchAtestado({ login: 'user', senha: 'wrong' }),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
    expect(postback).not.toHaveBeenCalled();
  });
});
