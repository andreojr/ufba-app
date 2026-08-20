import { DocentesService } from './docentes.service';
import type {
  DocenteLookupSalvo,
  DocenteRepository,
  DocenteSalvo,
} from './docente.repository';
import { PublicSigaaSession } from '../sigaa-engine/public-session';
import type {
  SigaaHttpClient,
  SigaaHttpRequest,
  SigaaHttpResponse,
} from '../sigaa-engine/session';

const DIA = 24 * 60 * 60 * 1000;
const FRESCO = new Date(Date.now() + 20 * DIA);
const VENCIDO = new Date(Date.now() - DIA);

class RepositorioFake implements DocenteRepository {
  lookups: DocenteLookupSalvo[] = [];
  docentes: DocenteSalvo[] = [];
  lookupsSalvos: DocenteLookupSalvo[] = [];
  docentesSalvos: DocenteSalvo[] = [];

  buscarLookups(nomes: string[]): Promise<DocenteLookupSalvo[]> {
    return Promise.resolve(
      this.lookups.filter((l) => nomes.includes(l.nomeNormalizado)),
    );
  }
  buscarDocentes(siapes: string[]): Promise<DocenteSalvo[]> {
    return Promise.resolve(
      this.docentes.filter((d) => siapes.includes(d.siape)),
    );
  }
  salvarDocente(docente: DocenteSalvo): Promise<void> {
    this.docentesSalvos.push(docente);
    return Promise.resolve();
  }
  salvarLookup(lookup: DocenteLookupSalvo): Promise<void> {
    this.lookupsSalvos.push(lookup);
    return Promise.resolve();
  }
}

function docenteSalvo(overrides: Partial<DocenteSalvo> = {}): DocenteSalvo {
  return {
    siape: '1815041',
    nome: 'ANTONIO LOPES APOLINARIO JUNIOR',
    departamento: 'DCC',
    unidade: 'IC',
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: 'IC- 2012',
    telefone: null,
    email: 'x@ufba.br',
    disciplinas: [],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0,
      mestradoConcluidas: 0,
      doutoradoAndamento: 0,
      doutoradoConcluidas: 0,
    },
    fetchedAt: new Date(),
    staleAfter: FRESCO,
    ...overrides,
  };
}

const PAGINA_BUSCA = `<input name="javax.faces.ViewState" value="j_id1" />`;

function resultadoBusca(siape: string, nome: string): string {
  return `<table class="listagem"><tr>
    <td><span class="nome">${nome}</span>
        <span class="departamento">DCC</span>
        <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=${siape}">ver</a></span>
    </td></tr></table>
    <input name="javax.faces.ViewState" value="j_id2" />`;
}

/** Answers by path/method so a test does not have to count requests. */
function httpRoteado(
  rotas: (req: SigaaHttpRequest) => SigaaHttpResponse | Error,
): SigaaHttpClient {
  return {
    request(req) {
      const resposta = rotas(req);
      if (resposta instanceof Error) return Promise.reject(resposta);
      return Promise.resolve(resposta);
    },
  };
}

function ok(body: string): SigaaHttpResponse {
  return { status: 200, headers: { 'set-cookie': 'JSESSIONID=x' }, body };
}

describe('DocentesService.resumoDoSemestre', () => {
  it('serves a fresh cached docente without touching SIGAA at all', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'ANTONIO LOPES APOLINARIO JUNIOR',
        nomeOriginal: 'ANTONIO LOPES APOLINARIO JUNIOR',
        siape: '1815041',
        staleAfter: FRESCO,
      },
    ];
    repo.docentes = [docenteSalvo()];

    const http = httpRoteado(() => new Error('SIGAA must not be called'));
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      {
        codigo: 'MATA65',
        nome: 'COMPUTAÇÃO GRÁFICA',
        docente: 'ANTONIO LOPES APOLINARIO JUNIOR',
      },
    ]);

    expect(resumo.perfil?.siape).toBe('1815041');
    expect(resumo.componentes).toEqual([
      { codigo: 'MATA65', nome: 'COMPUTAÇÃO GRÁFICA' },
    ]);
    expect(resumo.perfil?.selos.contato).toBe(true);
  });

  it('serves a fresh recorded miss as perfil null, without searching again', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'LARISSA BARBOSA LEONCIO PINHEIRO',
        nomeOriginal: 'LARISSA BARBOSA LEONCIO PINHEIRO',
        siape: null,
        staleAfter: FRESCO,
      },
    ];
    const http = httpRoteado(() => new Error('SIGAA must not be called'));
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      {
        codigo: 'MATA58',
        nome: 'X',
        docente: 'LARISSA BARBOSA LEONCIO PINHEIRO',
      },
    ]);
    expect(resumo.perfil).toBeNull();
  });

  // The spec's rule is symmetric: a stale row is served as-is and resynced
  // outside the request, whether it's a hit or a miss. A blocking re-search
  // here would turn the once-a-month "no public record" case into a cold
  // load for whichever student happens to open it that day.
  it('serves a stale miss as perfil null without awaiting SIGAA, and retries in the background', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'X Y',
        nomeOriginal: 'X Y',
        siape: null,
        staleAfter: VENCIDO,
      },
    ];

    // The GET that starts the session succeeds; the search POST never
    // settles. If the code awaited the re-resolution, this test would hang
    // instead of failing cleanly.
    const http = httpRoteado((req) =>
      req.method === 'GET' ? ok(PAGINA_BUSCA) : ok(PAGINA_BUSCA),
    );
    const requestSpy = jest
      .spyOn(http, 'request')
      .mockImplementation((req) =>
        req.method === 'POST'
          ? new Promise(() => {})
          : Promise.resolve(ok(PAGINA_BUSCA)),
      );

    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'X Y' },
    ]);

    expect(resumos[0].perfil).toBeNull();
    // The background re-resolution must actually have been attempted — the
    // search POST fired, not just "not awaited" (a no-op would also satisfy
    // that weaker bar).
    await Promise.resolve(); // let the fire-and-forget chain reach the POST
    const chamadaBusca = requestSpy.mock.calls.find(
      (chamada) => chamada[0].method === 'POST',
    );
    expect(chamadaBusca).toBeDefined();
  });

  it('resolves an unknown name end to end and persists both rows', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST')
        return ok(resultadoBusca('1815041', 'ANTONIO LOPES APOLINARIO JUNIOR'));
      if (req.path.includes('portal.jsf')) {
        return ok(
          '<div id="contato"><dl><dt>Sala</dt><dd>IC- 2012</dd></dl></div>',
        );
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      {
        codigo: 'MATA65',
        nome: 'CG',
        docente: 'Antonio Lopes Apolinario Junior',
      },
    ]);

    expect(resumo.perfil?.siape).toBe('1815041');
    expect(repo.docentesSalvos).toHaveLength(1);
    expect(repo.lookupsSalvos[0]).toMatchObject({
      nomeNormalizado: 'ANTONIO LOPES APOLINARIO JUNIOR',
      siape: '1815041',
    });
  });

  // portal.jsf's sidebar only carries the broad instituto — the specific
  // department exists nowhere but the search result. Reading it off the profile
  // page leaves every card's subtitle blank, and silently discards the
  // department-over-instituto choice the search parser makes.
  it('takes departamento from the search result, not the profile page', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem"><tr><td>
             <span class="nome">ANTONIO LOPES APOLINARIO JUNIOR</span>
             <span class="departamento">DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC</span>
             <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=1815041">v</a></span>
           </td></tr></table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      // A profile page with no department anywhere in it — the real shape.
      return ok(
        '<div id="contato"><dl><dt>Sala</dt><dd>IC- 2012</dd></dl></div>',
      );
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      {
        codigo: 'MATA65',
        nome: 'CG',
        docente: 'ANTONIO LOPES APOLINARIO JUNIOR',
      },
    ]);

    expect(resumo.perfil?.departamento).toBe(
      'DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC',
    );
    expect(repo.docentesSalvos[0].departamento).toBe(
      'DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC',
    );
  });

  it('records a miss when the search genuinely returns nothing', async () => {
    const repo = new RepositorioFake();
    // The real shape of a genuine zero-result: SIGAA's own explicit message,
    // not merely the absence of a results table (that shape is what a SIGAA
    // outage/maintenance page also produces, and must NOT read as a miss).
    const http = httpRoteado((req) =>
      req.method === 'GET'
        ? ok(PAGINA_BUSCA)
        : ok(
            '<ul class="erros"><li>Nenhum docente foi encontrado de acordo com os critérios de busca informados</li></ul>' +
              '<input name="javax.faces.ViewState" value="j_id2" />',
          ),
    );
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      {
        codigo: 'MATA58',
        nome: 'X',
        docente: 'LARISSA BARBOSA LEONCIO PINHEIRO',
      },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos[0]).toMatchObject({ siape: null });
  });

  // The rule that matters most: thirty seconds of downtime must not freeze a
  // "does not exist" for thirty days.
  it('does NOT record a miss when the search fails with a network error', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) =>
      req.method === 'GET' ? ok(PAGINA_BUSCA) : new Error('ECONNRESET'),
    );
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'FULANO DE TAL' },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  it('does NOT record a miss when SIGAA rejects the query with an error message', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) =>
      req.method === 'GET'
        ? ok(PAGINA_BUSCA)
        : ok(
            '<ul class="erros"><li>É necessário informar pelo menos 4 caracteres</li></ul>',
          ),
    );
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'ABC' },
    ]);

    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  it('keeps resolving the other docentes when one of them fails', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return req.body?.['form:nome'] === 'QUEBRADO'
          ? new Error('ECONNRESET')
          : ok(resultadoBusca('1815041', 'FUNCIONA'));
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'QUEBRADO' },
      { codigo: 'B1', nome: 'B', docente: 'FUNCIONA' },
    ]);

    expect(
      resumos.find((r) => r.nomeOriginal === 'QUEBRADO')?.perfil,
    ).toBeNull();
    expect(
      resumos.find((r) => r.nomeOriginal === 'FUNCIONA')?.perfil,
    ).not.toBeNull();
  });

  it('groups every course a docente teaches you under one entry', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'X Y',
        nomeOriginal: 'X Y',
        siape: '2530359',
        staleAfter: FRESCO,
      },
    ];
    repo.docentes = [docenteSalvo({ siape: '2530359' })];
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const resumos = await service.resumoDoSemestre([
      { codigo: 'ENGG54', nome: 'A', docente: 'X Y' },
      { codigo: 'ENGG67', nome: 'B', docente: 'X Y' },
    ]);

    expect(resumos).toHaveLength(1);
    expect(resumos[0].componentes.map((c) => c.codigo)).toEqual([
      'ENGG54',
      'ENGG67',
    ]);
  });

  it('prefers the exact normalised match over a longer name the substring search dragged in', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">ALINE SILVA DE MOURA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">ALINE SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'ALINE SILVA' },
    ]);
    expect(resumo.perfil?.siape).toBe('222');
  });

  // A stale row is a month-old copy of a page that changes once a term. Serving
  // it now and resyncing afterwards is what keeps a slow or dead SIGAA from
  // turning into a hung screen.
  it('serves a stale row without waiting on SIGAA', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'X Y',
        nomeOriginal: 'X Y',
        siape: '1815041',
        staleAfter: VENCIDO,
      },
    ];
    repo.docentes = [
      docenteSalvo({ staleAfter: VENCIDO, sala: 'SALA ANTIGA' }),
    ];

    // Never settles: if the response were awaited, this test would time out.
    const http = httpRoteado(() => ok(PAGINA_BUSCA));
    const requestSpy = jest
      .spyOn(http, 'request')
      .mockReturnValue(new Promise(() => {}));

    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );
    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'X Y' },
    ]);

    expect(resumos[0].perfil?.siape).toBe('1815041');
    expect(resumos[0].perfil?.selos.contato).toBe(true);
    // The resync itself must actually have been attempted (a GET fired) —
    // not just "not awaited", which a no-op would also satisfy.
    expect(requestSpy).toHaveBeenCalled();
    const primeiraChamada = requestSpy.mock.calls[0][0];
    expect(primeiraChamada.method).toBe('GET');
    expect(primeiraChamada.path).toContain('portal.jsf?siape=1815041');
  });

  // Homonyms have not appeared in the wild yet, but attaching the wrong
  // stranger's profile to a real course is the one failure worse than showing
  // none, so the tie is broken on evidence or not at all.
  it('breaks a homonym tie using the course the student is enrolled in', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      if (req.path.includes('disciplinas.jsf?siape=222')) {
        return ok(`<table class="listagem">
          <tr><td class="anoPeriodo" colspan="5">2026.2</td></tr>
          <tr><td class="codigo">MATA65</td><td>CG</td><td class="ch">60h</td><td class="horario">24T34</td></tr>
        </table>`);
      }
      if (req.path.includes('disciplinas.jsf?siape=111')) {
        return ok('<table class="listagem"></table>');
      }
      return ok('<div id="contato"><dl><dt>Sala</dt><dd>IC- 1</dd></dl></div>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'JOAO SILVA' },
    ]);
    expect(resumo.perfil?.siape).toBe('222');
  });

  // Two or more non-exact candidates is a guess, not evidence — the same
  // rule the homonym path already enforces, applied symmetrically to the
  // "no exact match" branch.
  it('refuses to guess between two non-exact candidates', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">ALINE SILVA DE MOURA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">ALINE SILVA COSTA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      return ok('<html></html>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'ALINE SILVA' },
    ]);
    expect(resumo.perfil).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  // A failure to establish the public search session (SIGAA down, network
  // error) must degrade this batch, not throw away resumos already built
  // from cache for other docentes in the same request.
  it('degrades to null profiles when the session fails to start, keeping already-cached results', async () => {
    const repo = new RepositorioFake();
    repo.lookups = [
      {
        nomeNormalizado: 'X Y',
        nomeOriginal: 'X Y',
        siape: '1815041',
        staleAfter: FRESCO,
      },
    ];
    repo.docentes = [docenteSalvo({ siape: '1815041' })];

    const http = httpRoteado((req) =>
      req.method === 'GET' && req.path.includes('busca_docentes')
        ? new Error('ECONNRESET')
        : ok('<html></html>'),
    );
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const resumos = await service.resumoDoSemestre([
      { codigo: 'A1', nome: 'A', docente: 'X Y' },
      { codigo: 'B1', nome: 'B', docente: 'NUNCA VISTO' },
    ]);

    expect(resumos.find((r) => r.nomeOriginal === 'X Y')?.perfil?.siape).toBe(
      '1815041',
    );
    expect(
      resumos.find((r) => r.nomeOriginal === 'NUNCA VISTO')?.perfil,
    ).toBeNull();
    expect(repo.lookupsSalvos).toHaveLength(0);
  });

  it('refuses to guess when the tie cannot be broken', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado((req) => {
      if (req.method === 'GET' && req.path.includes('busca_docentes'))
        return ok(PAGINA_BUSCA);
      if (req.method === 'POST') {
        return ok(
          `<table class="listagem">
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=111">v</a></span></td></tr>
             <tr><td><span class="nome">JOAO SILVA</span>
               <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=222">v</a></span></td></tr>
           </table><input name="javax.faces.ViewState" value="j_id2" />`,
        );
      }
      return ok('<table class="listagem"></table>');
    });
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    const [resumo] = await service.resumoDoSemestre([
      { codigo: 'MATA65', nome: 'CG', docente: 'JOAO SILVA' },
    ]);
    expect(resumo.perfil).toBeNull();
    // Undecidable is not the same as absent, so no miss is recorded.
    expect(repo.lookupsSalvos).toHaveLength(0);
  });
});

describe('DocentesService.perfil', () => {
  it('reads straight from the repository', async () => {
    const repo = new RepositorioFake();
    repo.docentes = [docenteSalvo()];
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    expect((await service.perfil('1815041'))?.siape).toBe('1815041');
  });

  it('returns null for an unknown siape', async () => {
    const repo = new RepositorioFake();
    const http = httpRoteado(() => new Error('must not be called'));
    const service = new DocentesService(
      repo,
      http,
      () => new PublicSigaaSession(http),
    );

    expect(await service.perfil('999')).toBeNull();
  });
});
