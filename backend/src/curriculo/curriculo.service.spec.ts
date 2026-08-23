import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ComponenteDesconhecidoError,
  CurriculoService,
  CursoDesconhecidoError,
  SemEstruturaAtivaError,
} from './curriculo.service';
import type { CurriculoRepository } from './curriculo.repository';
import type { SigaaHttpClient, SigaaHttpRequest } from '../sigaa-engine/session';
import type { HistoricoRepository, TrajetoriaSalva } from '../sigaa-engine/historico.repository';
import type { Historico } from '../sigaa-engine/parsers/historico';

function parserFixture(name: string): string {
  return readFileSync(
    join(__dirname, '..', 'sigaa-engine', 'parsers', '__fixtures__', name),
    'utf-8',
  );
}

function fakeRepository(
  overrides: Partial<CurriculoRepository> = {},
): jest.Mocked<CurriculoRepository> {
  return {
    buscarCursos: jest.fn().mockResolvedValue([]),
    // Fresh relative to this spec file's fixed `agora` (2026-01-01) —
    // individual tests that need the directory to look empty or stale
    // override buscarCursos/buscarDiretorioAtualizadoEm themselves.
    buscarDiretorioAtualizadoEm: jest
      .fn()
      .mockResolvedValue(new Date('2025-12-15T00:00:00Z')),
    salvarCursos: jest.fn().mockResolvedValue(undefined),
    buscarCursoPorId: jest.fn().mockResolvedValue(null),
    buscarEstrutura: jest.fn().mockResolvedValue(null),
    salvarEstrutura: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// A minimal fake HTTP client that answers each request from a path→body map,
// so the parsers run against real (fixture-derived) markup rather than mocks.
function fakeHttp(porPath: Record<string, string>): SigaaHttpClient {
  return {
    async request(req) {
      for (const [pattern, body] of Object.entries(porPath)) {
        if (req.path.includes(pattern)) {
          return { status: 200, headers: {}, body };
        }
      }
      throw new Error(`no fake response registered for ${req.path}`);
    },
  };
}

const LISTA_HTML = `
  <table class="listagem"><tr>
    <td>ENGENHARIA DA COMPUTAÇÃO</td><td>SALVADOR</td>
    <td><a href="portal.jsf?id=1876880&lc=pt_BR&nivel=G" title="Visualizar Página do Curso"></a></td>
  </tr></table>`;

// A fake HTTP client for the full resolution flow, distinguishing requests
// that share a path (curriculo.jsf is hit once by GET, once by POST) by
// method, and the two concurrent per-component POSTs (both to
// resumo_curriculo.jsf) by the `id` in their body — order-independent, unlike
// a plain queue, since the two component fetches run concurrently and are
// not guaranteed to reach the fake client in a fixed order. Every request is
// recorded so a test can assert on exactly what was POSTed.
function fakeHttpParaResolucao(respostas: {
  cursoEstruturas: string;
  matriz: string;
  detalhePorId: Record<string, string>;
}): SigaaHttpClient & { requests: SigaaHttpRequest[] } {
  const requests: SigaaHttpRequest[] = [];
  return {
    requests,
    async request(req) {
      requests.push(req);
      // Check resumo_curriculo.jsf first: its path also contains the
      // substring "curriculo.jsf", so the reverse order would misroute every
      // per-component detail POST to the matrix response instead.
      if (req.path.includes('resumo_curriculo.jsf')) {
        const id = req.body?.id;
        const body = id ? respostas.detalhePorId[id] : undefined;
        if (body) {
          return { status: 200, headers: {}, body };
        }
      }
      if (req.path.includes('curriculo.jsf') && req.method === 'GET') {
        return { status: 200, headers: {}, body: respostas.cursoEstruturas };
      }
      if (req.path.includes('curriculo.jsf') && req.method === 'POST') {
        return { status: 200, headers: {}, body: respostas.matriz };
      }
      throw new Error(
        `no fake response registered for ${req.method} ${req.path} (${JSON.stringify(req.body)})`,
      );
    },
  };
}

// Realistic excerpts of the real captured fixtures (see Task 1's fixtures) —
// trimmed to the two components (FISD36/34997, ENG295/30548) whose full
// detail-page fixtures already exist, but preserving the exact real
// onclick/form markup so this test exercises the real parsers end to end.
const CURSO_ESTRUTURAS_HTML = `
  <form id="formCurriculosCurso" name="formCurriculosCurso" method="post">
    <input type="hidden" name="formCurriculosCurso" value="formCurriculosCurso" />
    <input type="hidden" name="nivel" value="G" />
    <input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="j_id1" />
  </form>
  <table id="table_lt"><tbody>
    <tr class="linha_par">
      <td>Detalhes da Estrutura Curricular G20251, Criado em  2025</td>
      <td>Ativa</td>
      <td><a title="Visualizar Estrutura Curricular" onclick="jsfcljs(document.getElementById('formCurriculosCurso'),{'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1':'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1','id':'2413433'},'');"></a></td>
    </tr>
  </tbody></table>`;

const ESTRUTURA_RESUMO_HTML = `
  <form id="formulario" name="formulario" method="post" action="/sigaa/public/curso/resumo_curriculo.jsf">
  <input type="hidden" name="formulario" value="formulario" />
  <table class="formulario" style="width:90%">
    <caption class="formulario">Estrutura Curricular</caption>
    <tr><th>Código: </th><td>G20251</td></tr>
    <tr><th>Período Letivo de Entrada em Vigor: </th><td>2025.2</td></tr>
    <tr><th width="48%">Total Mínima: </th><td>3610h</td></tr>
    <tr><th>Subtotal de CH de Aula: </th><td>2940h</td></tr>
    <tr><th>Total:</th><td>3150h</td></tr>
    <tr><th width="48%">Carga Horária Optativa Mínima: </th><td>360h</td></tr>
    <tr><th width="48%">Carga Horária Complementar Mínima: </th><td>100h</td></tr>
    <tr>
      <th>Prazo Para Conclusão (em semestres): </th>
      <td><table><tr>
        <th>Mínimo: </th><td>12</td>
        <th>Médio: </th><td>12</td>
        <th>Máximo: </th><td>18</td>
      </tr></table></td>
    </tr>
    <tr><td colspan="2">
      <div id="optativas">
        <table class="subFormulario" width="100%">
          <caption>Optativas</caption>
          <tr class="linhaPar">
            <td>ENG295 - HIGIENE E SEGURANÇA NO TRABALHO - 60h</td>
            <td width="8%"><i>Optativa</i></td>
            <td style="text-align: center">
              <a href="#" title="Visualizar Detalhes do Componente" onclick="var a=function(){return prevenirDuploClique();};var b=function(){if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('formulario'),{'formulario:j_id_jsp_337523315_46':'formulario:j_id_jsp_337523315_46','id':'30548','publico':'public'},'');}return false};return (a()==false) ? false : b();"><img src="/sigaa/img/view.gif" /></a>
            </td>
          </tr>
        </table>
      </div>
      <div id="semestre1">
        <table class="subFormulario" width="100%">
          <caption>1º Nível</caption>
          <tr class="linhaPar">
            <td>FISD36 - FÍSICA GERAL TEÓRICA I - 60h</td>
            <td width="8%"><i>Obrigatória</i></td>
            <td style="text-align: center">
              <a href="#" title="Visualizar Detalhes do Componente" onclick="var a=function(){return prevenirDuploClique();};var b=function(){if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('formulario'),{'formulario:j_id_jsp_337523315_66':'formulario:j_id_jsp_337523315_66','id':'34997','publico':'public'},'');}return false};return (a()==false) ? false : b();"><img src="/sigaa/img/view.gif" /></a>
            </td>
          </tr>
        </table>
      </div>
    </td></tr>
  </table>
  <input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="j_id2" />
  </form>`;

describe('CurriculoService', () => {
  const agora = () => new Date('2026-01-01T00:00:00Z');

  it('refreshes the course directory when empty and returns it', async () => {
    const repository = fakeRepository();
    const service = new CurriculoService(fakeHttp({ 'lista.jsf': LISTA_HTML }), repository, agora);

    const cursos = await service.listarCursos();

    expect(repository.salvarCursos).toHaveBeenCalledWith([
      { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
    ]);
    expect(cursos).toEqual([
      { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
    ]);
  });

  it('does not refresh the directory when it already has rows and is not yet stale', async () => {
    const repository = fakeRepository({
      buscarCursos: jest
        .fn()
        .mockResolvedValue([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]),
      buscarDiretorioAtualizadoEm: jest
        .fn()
        .mockResolvedValue(new Date('2025-12-15T00:00:00Z')),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    await service.listarCursos();

    expect(repository.salvarCursos).not.toHaveBeenCalled();
  });

  it('refreshes the directory when it has rows but they have gone stale', async () => {
    const repository = fakeRepository({
      buscarCursos: jest
        .fn()
        .mockResolvedValue([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]),
      buscarDiretorioAtualizadoEm: jest
        .fn()
        .mockResolvedValue(new Date('2025-01-01T00:00:00Z')),
    });
    const service = new CurriculoService(fakeHttp({ 'lista.jsf': LISTA_HTML }), repository, agora);

    const cursos = await service.listarCursos();

    expect(repository.salvarCursos).toHaveBeenCalled();
    expect(cursos).toEqual([
      { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
    ]);
  });

  it('serves a fresh cached estrutura without touching SIGAA', async () => {
    const cached = {
      idSigaa: 'e1',
      codigo: 'G20251',
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      fetchedAt: new Date('2025-12-01T00:00:00Z'),
      staleAfter: new Date('2026-06-01T00:00:00Z'),
      componentes: [],
    };
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
      buscarEstrutura: jest.fn().mockResolvedValue(cached),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    const resolvido = await service.resolverCurso('1');

    expect(resolvido).toEqual(cached);
  });

  it('re-resolves against SIGAA instead of serving a stale cached estrutura as-is', async () => {
    const staleCached = {
      idSigaa: 'e1',
      codigo: 'G20251',
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      fetchedAt: new Date('2025-06-01T00:00:00Z'),
      // agora() is 2026-01-01 — this row already went stale.
      staleAfter: new Date('2025-12-01T00:00:00Z'),
      componentes: [],
    };
    const http = fakeHttpParaResolucao({
      cursoEstruturas: CURSO_ESTRUTURAS_HTML,
      matriz: ESTRUTURA_RESUMO_HTML,
      detalhePorId: {
        '30548': parserFixture('componente-resumo-com-prerequisito.html'),
        '34997': parserFixture('componente-resumo-sem-prerequisito.html'),
      },
    });
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1876880', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
      buscarEstrutura: jest.fn().mockResolvedValue(staleCached),
    });
    const service = new CurriculoService(http, repository, agora);

    await service.resolverCurso('1876880');

    expect(repository.salvarEstrutura).toHaveBeenCalled();
    expect(http.requests.some((r) => r.method === 'GET' && r.path.includes('curriculo.jsf'))).toBe(
      true,
    );
  });

  it('resolves a course end to end — directory → estruturas → matrix → per-component sequential fetch → persistence — with real request bodies', async () => {
    const http = fakeHttpParaResolucao({
      cursoEstruturas: CURSO_ESTRUTURAS_HTML,
      matriz: ESTRUTURA_RESUMO_HTML,
      detalhePorId: {
        '30548': parserFixture('componente-resumo-com-prerequisito.html'),
        '34997': parserFixture('componente-resumo-sem-prerequisito.html'),
      },
    });
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1876880', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
      // null on the first call (no cache yet); resolverCurso re-reads after
      // salvarEstrutura, so the second call must return the freshly saved row.
      buscarEstrutura: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          idSigaa: '2413433',
          codigo: 'G20251',
          anoPeriodoImplementacao: '2025.2',
          cargaHorariaTotal: 3610,
          cargaHorariaObrigatoria: 3150,
          cargaHorariaOptativaMinima: 360,
          cargaHorariaComplementarMinima: 100,
          prazoMinimoSemestres: 12,
          prazoMedioSemestres: 12,
          prazoMaximoSemestres: 18,
          fetchedAt: agora(),
          staleAfter: new Date('2026-02-01T00:00:00Z'),
          componentes: [],
        }),
    });
    const service = new CurriculoService(http, repository, agora);

    await service.resolverCurso('1876880');

    expect(repository.salvarEstrutura).toHaveBeenCalledTimes(1);
    const [, idSigaa, codigo, resumo, componentesDetalhados] =
      repository.salvarEstrutura.mock.calls[0];
    expect(idSigaa).toBe('2413433');
    expect(codigo).toBe('G20251');
    expect(resumo.cargaHorariaTotal).toBe(3610);

    const eng295 = componentesDetalhados.find((c: { codigo: string }) => c.codigo === 'ENG295');
    const fisd36 = componentesDetalhados.find((c: { codigo: string }) => c.codigo === 'FISD36');
    expect(eng295?.preRequisito).toContain('FISD36');
    expect(fisd36?.preRequisito).toBeNull();

    // The matrix POST must carry the enclosing form's own hidden fields
    // (formCurriculosCurso marker + nivel) alongside the ajax action's own
    // params — see C1: without the form marker, JSF never decodes the
    // submission as an actual postback.
    const matrizRequest = http.requests.find(
      (r) => r.method === 'POST' && r.path.includes('curriculo.jsf'),
    );
    expect(matrizRequest?.body).toMatchObject({
      formCurriculosCurso: 'formCurriculosCurso',
      nivel: 'G',
      'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1':
        'formCurriculosCurso:j_id_jsp_1561883746_32j_id_1',
      id: '2413433',
    });

    // Each component-detail POST must carry the row's own JSF field key
    // (not just id/publico) — see I3.
    const detalheRequests = http.requests.filter(
      (r) => r.method === 'POST' && r.path.includes('resumo_curriculo.jsf'),
    );
    expect(detalheRequests).toHaveLength(2);
    const porId = Object.fromEntries(
      detalheRequests.map((r) => [r.body?.id, r.body]),
    );
    expect(porId['30548']).toMatchObject({
      formulario: 'formulario',
      'formulario:j_id_jsp_337523315_46': 'formulario:j_id_jsp_337523315_46',
      publico: 'public',
    });
    expect(porId['34997']).toMatchObject({
      formulario: 'formulario',
      'formulario:j_id_jsp_337523315_66': 'formulario:j_id_jsp_337523315_66',
      publico: 'public',
    });
  });

  it('fetches component details one at a time — resumo_curriculo.jsf is stateful per JSF session', async () => {
    // Running these in parallel made SIGAA answer a component's POST with a
    // *sibling* component's detail page: the persisted grade came out with
    // runs of components sharing one pré-requisito expression, and even a
    // component listing itself as its own pré-requisito. The endpoint keeps
    // the "currently shown component" in the session, so overlapping
    // requests are never safe, no matter whose ViewState they carry.
    const base = fakeHttpParaResolucao({
      cursoEstruturas: CURSO_ESTRUTURAS_HTML,
      matriz: ESTRUTURA_RESUMO_HTML,
      detalhePorId: {
        '30548': parserFixture('componente-resumo-com-prerequisito.html'),
        '34997': parserFixture('componente-resumo-sem-prerequisito.html'),
      },
    });
    let emVoo = 0;
    let maxEmVoo = 0;
    const http: SigaaHttpClient = {
      async request(req) {
        const ehDetalhe =
          req.method === 'POST' && req.path.includes('resumo_curriculo.jsf');
        if (ehDetalhe) {
          emVoo += 1;
          maxEmVoo = Math.max(maxEmVoo, emVoo);
        }
        // Yield, so a genuinely parallel batch has both requests overlapping
        // here rather than each completing before the next one starts.
        await new Promise((resolve) => setImmediate(resolve));
        try {
          return await base.request(req);
        } finally {
          if (ehDetalhe) {
            emVoo -= 1;
          }
        }
      },
    };
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1876880', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
    });
    const service = new CurriculoService(http, repository, agora);

    await service.resolverCurso('1876880').catch(() => undefined);

    expect(repository.salvarEstrutura).toHaveBeenCalledTimes(1);
    expect(maxEmVoo).toBe(1);
  });

  it('never persists detail read off a page describing a different component', async () => {
    // The wrong-page failure mode above is invisible in the response itself
    // unless the código printed on the page is checked against the one asked
    // for. Silently keeping it is the worst outcome: a bogus pré-requisito
    // expression shows the student a lock (or an unlock) that is not real.
    const http = fakeHttpParaResolucao({
      cursoEstruturas: CURSO_ESTRUTURAS_HTML,
      matriz: ESTRUTURA_RESUMO_HTML,
      detalhePorId: {
        '30548': parserFixture('componente-resumo-com-prerequisito.html'),
        // FISD36's request answered with ENG295's page.
        '34997': parserFixture('componente-resumo-com-prerequisito.html'),
      },
    });
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1876880', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
    });
    const service = new CurriculoService(http, repository, agora);

    await service.resolverCurso('1876880').catch(() => undefined);

    const [, , , , componentesDetalhados] = repository.salvarEstrutura.mock.calls[0];
    const fisd36 = componentesDetalhados.find((c: { codigo: string }) => c.codigo === 'FISD36');
    expect(fisd36?.preRequisito).toBeNull();
    expect(fisd36?.unidadeResponsavel).toBeNull();
    // The component whose page really was its own keeps its detail.
    const eng295 = componentesDetalhados.find((c: { codigo: string }) => c.codigo === 'ENG295');
    expect(eng295?.preRequisito).toContain('FISD36');
  });

  it('throws SemEstruturaAtivaError, writing nothing, when no structure is marked Ativa', async () => {
    const repository = fakeRepository({
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }),
    });
    const ESTRUTURAS_SEM_ATIVA = `
      <form>
        <input type="hidden" name="javax.faces.ViewState" value="j_id1" />
      </form>
      <table id="table_lt"><tr class="linha_par">
        <td>Detalhes da Estrutura Curricular T20252, Criado em  2025</td>
        <td>Inativa</td>
        <td><a title="Visualizar Estrutura Curricular" onclick="jsfcljs(f,{'x':'x','id':'1'},'')"></a></td>
      </tr></table>`;
    const service = new CurriculoService(
      fakeHttp({ 'curriculo.jsf': ESTRUTURAS_SEM_ATIVA }),
      repository,
      agora,
    );

    await expect(service.resolverCurso('1')).rejects.toThrow(SemEstruturaAtivaError);
    expect(repository.salvarEstrutura).not.toHaveBeenCalled();
  });

  it('resolves a course by the profile-style "NOME/SIGLA - Campus" name and delegates to resolverCurso, even though a real undergrad profile spells the course differently ("DE") than the real directory ("DA")', async () => {
    const cached = {
      idSigaa: 'e1',
      codigo: 'G20251',
      anoPeriodoImplementacao: '2025.2',
      cargaHorariaTotal: 100,
      cargaHorariaObrigatoria: 100,
      cargaHorariaOptativaMinima: 0,
      cargaHorariaComplementarMinima: 0,
      prazoMinimoSemestres: 1,
      prazoMedioSemestres: 1,
      prazoMaximoSemestres: 1,
      fetchedAt: new Date('2025-12-01T00:00:00Z'),
      staleAfter: new Date('2026-06-01T00:00:00Z'),
      componentes: [],
    };
    const repository = fakeRepository({
      // "ENGENHARIA DA COMPUTAÇÃO" is the real curso-lista.html spelling
      // (see __fixtures__/curso-lista.html); "ENGENHARIA DE COMPUTAÇÃO/PGCOMP
      // - Salvador" below is the real spelling captured off an actual
      // undergrad's own profile page (see
      // __fixtures__/portal-discente-perfil.html) — SIGAA itself is
      // inconsistent about the connector word, which is exactly what this
      // test guards against regressing.
      buscarCursos: jest.fn().mockResolvedValue([
        { idSigaa: '1876880', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
        { idSigaa: '2', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'Vitória da Conquista', nivel: 'G' },
      ]),
      buscarCursoPorId: jest
        .fn()
        .mockResolvedValue({ idSigaa: '1876880', nome: 'X', sede: 'Salvador', nivel: 'G' }),
      buscarEstrutura: jest.fn().mockResolvedValue(cached),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    const resolvido = await service.resolverPorNomeUsuario(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
    );

    expect(resolvido).toEqual(cached);
    expect(repository.buscarEstrutura).toHaveBeenCalledWith('1876880');
  });

  it('throws CursoDesconhecidoError when no course in the directory matches the profile name', async () => {
    const repository = fakeRepository({
      buscarCursos: jest
        .fn()
        .mockResolvedValue([{ idSigaa: '1', nome: 'ENGENHARIA CIVIL', sede: 'Salvador', nivel: 'G' }]),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    await expect(
      service.resolverPorNomeUsuario('ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador'),
    ).rejects.toThrow(CursoDesconhecidoError);
    expect(repository.buscarEstrutura).not.toHaveBeenCalled();
  });

  describe('vizinhosCurriculares / vizinhosCurricularesPorNomeUsuario', () => {
    const estruturaSalva = {
      idSigaa: 'e1',
      codigo: 'G20251',
      anoPeriodoImplementacao: '2025.1',
      cargaHorariaTotal: 3200,
      cargaHorariaObrigatoria: 2400,
      cargaHorariaOptativaMinima: 400,
      cargaHorariaComplementarMinima: 200,
      prazoMinimoSemestres: 8,
      prazoMedioSemestres: 10,
      prazoMaximoSemestres: 14,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      staleAfter: new Date('2027-01-01T00:00:00Z'),
      componentes: [
        {
          idSigaa: 'c1',
          codigo: 'MATA02',
          nome: 'Cálculo A',
          cargaHoraria: 68,
          natureza: 'OBRIGATORIA' as const,
          periodo: 1,
          unidadeResponsavel: null,
          preRequisito: null,
          coRequisito: null,
          equivalencias: null,
        },
        {
          idSigaa: 'c2',
          codigo: 'MATA03',
          nome: 'Cálculo B',
          cargaHoraria: 68,
          natureza: 'OBRIGATORIA' as const,
          periodo: 2,
          unidadeResponsavel: null,
          preRequisito: 'MATA02',
          coRequisito: null,
          equivalencias: null,
        },
      ],
    };

    function historicoFalso(cursados: Historico['cursados']): Historico {
      return {
        emitidoEm: '2026-01-01',
        curriculo: 'G20251 - 2025.1',
        nomeCurso: 'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR',
        periodoLetivoAtual: 2,
        prazoConclusaoPadrao: '2029.1',
        prazoConclusaoMaximo: '2032.1',
        indices: { cr: null, iap: null },
        cursados,
        pendentesObrigatorios: [],
        cargaHoraria: {
          obrigatorias: { exigida: 3150, integralizada: 0, pendente: 3150 },
          optativas: { exigida: 360, integralizada: 0, pendente: 360 },
          complementares: { exigida: 100, integralizada: 0, pendente: 100 },
          total: { exigida: 3610, integralizada: 0, pendente: 3610 },
        },
        equivalencias: [],
        observacoes: [],
      };
    }

    function fakeHistoricoRepository(
      overrides: Partial<HistoricoRepository> = {},
    ): jest.Mocked<HistoricoRepository> {
      return {
        buscar: jest.fn().mockResolvedValue(null),
        salvar: jest.fn().mockResolvedValue(undefined),
        reconciliarPlano: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('vizinhosCurriculares busca a estrutura já resolvida e o histórico do usuário, e monta os vizinhos', async () => {
      const repository = fakeRepository({
        buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
      });
      const salva: TrajetoriaSalva = {
        historico: historicoFalso([
          { semestre: '2025.1', natureza: 'OB', codigo: 'MATA02', nome: 'Cálculo A', cargaHoraria: 68, nota: 8, situacao: 'APR', docente: null },
        ]),
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        plano: [],
      };
      const historicoRepository = fakeHistoricoRepository({
        buscar: jest.fn().mockResolvedValue(salva),
      });
      const service = new CurriculoService(fakeHttp({}), repository, agora, historicoRepository);
      const vizinhos = await service.vizinhosCurriculares('curso-1', 'MATA03', 'user-1');
      expect(vizinhos.atual).toEqual({ codigo: 'MATA03', nome: 'Cálculo B', situacao: 'liberada' });
      expect(vizinhos.preRequisitos).toEqual([
        { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
      ]);
      expect(historicoRepository.buscar).toHaveBeenCalledWith('user-1');
    });

    it('vizinhosCurriculares conta situação TRANS (e não só APR) como aprovada pro cálculo de liberada/bloqueada', async () => {
      const repository = fakeRepository({
        buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
      });
      const salva: TrajetoriaSalva = {
        historico: historicoFalso([
          { semestre: '2025.1', natureza: 'OB', codigo: 'MATA02', nome: 'Cálculo A', cargaHoraria: 68, nota: null, situacao: 'TRANS', docente: null },
        ]),
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        plano: [],
      };
      const historicoRepository = fakeHistoricoRepository({
        buscar: jest.fn().mockResolvedValue(salva),
      });
      const service = new CurriculoService(fakeHttp({}), repository, agora, historicoRepository);
      const vizinhos = await service.vizinhosCurriculares('curso-1', 'MATA03', 'user-1');
      // MATA03 depende de MATA02, que veio TRANS (transferência) no histórico
      // — não um APR literal, mas ainda uma situação integralizada. Deve
      // liberar MATA03, não bloquear.
      expect(vizinhos.atual).toEqual({ codigo: 'MATA03', nome: 'Cálculo B', situacao: 'liberada' });
      expect(vizinhos.preRequisitos).toEqual([
        { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
      ]);
    });

    it('vizinhosCurricularesPorNomeUsuario resolve o curso pelo nome e monta os vizinhos', async () => {
      const repository = fakeRepository({
        buscarCursos: jest.fn().mockResolvedValue([
          { idSigaa: 'curso-1', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
        ]),
        buscarDiretorioAtualizadoEm: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
        buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
      });
      const historicoRepository = fakeHistoricoRepository();
      const service = new CurriculoService(fakeHttp({}), repository, agora, historicoRepository);
      const vizinhos = await service.vizinhosCurricularesPorNomeUsuario(
        'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
        'MATA02',
        'user-1',
      );
      expect(vizinhos.atual.codigo).toBe('MATA02');
    });

    it('sem histórico persistido (usuário nunca sincronizou), tudo vira bloqueada por padrão — exceto quem não tem pré-requisito, que vira liberada', async () => {
      const repository = fakeRepository({
        buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
      });
      // fakeHistoricoRepository() sem overrides já devolve buscar() -> null.
      const service = new CurriculoService(fakeHttp({}), repository, agora, fakeHistoricoRepository());
      const vizinhos = await service.vizinhosCurriculares('curso-1', 'MATA03', 'user-1');
      expect(vizinhos.atual.situacao).toBe('bloqueada');
      expect(vizinhos.preRequisitos).toEqual([
        { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'liberada' },
      ]);
    });

    it('vizinhosCurriculares lança ComponenteDesconhecidoError quando o código não está na estrutura ativa', async () => {
      const repository = fakeRepository({
        buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
      });
      const service = new CurriculoService(fakeHttp({}), repository, agora, fakeHistoricoRepository());
      await expect(
        service.vizinhosCurriculares('curso-1', 'NAOEXISTE01', 'user-1'),
      ).rejects.toThrow(ComponenteDesconhecidoError);
    });
  });
});
