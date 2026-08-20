import {
  CurriculoService,
  CursoDesconhecidoError,
  SemEstruturaAtivaError,
} from './curriculo.service';
import type { CurriculoRepository } from './curriculo.repository';
import type { SigaaHttpClient } from '../sigaa-engine/session';

function fakeRepository(
  overrides: Partial<CurriculoRepository> = {},
): jest.Mocked<CurriculoRepository> {
  return {
    buscarCursos: jest.fn().mockResolvedValue([]),
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

  it('does not refresh the directory when it already has rows', async () => {
    const repository = fakeRepository({
      buscarCursos: jest
        .fn()
        .mockResolvedValue([{ idSigaa: '1', nome: 'X', sede: 'SALVADOR', nivel: 'G' }]),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora);

    await service.listarCursos();

    expect(repository.salvarCursos).not.toHaveBeenCalled();
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

  it('resolves a course by the profile-style "NOME/SIGLA - Campus" name and delegates to resolverCurso', async () => {
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
      buscarCursos: jest.fn().mockResolvedValue([
        { idSigaa: '1876880', nome: 'ENGENHARIA DE COMPUTAÇÃO', sede: 'Salvador', nivel: 'G' },
        { idSigaa: '2', nome: 'ENGENHARIA DE COMPUTAÇÃO', sede: 'Vitória da Conquista', nivel: 'G' },
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
});
