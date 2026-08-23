import { Logger } from '@nestjs/common';
import { CurriculoPublicSession } from '../sigaa-engine/curriculo-session';
import type { SigaaHttpClient } from '../sigaa-engine/session';
import { parseCursoLista, type CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import { parseCursoEstruturas } from '../sigaa-engine/parsers/curso-estruturas';
import {
  parseEstruturaResumo,
  type EstruturaResumo,
} from '../sigaa-engine/parsers/estrutura-resumo';
import { parseComponenteResumo } from '../sigaa-engine/parsers/componente-resumo';
import type {
  ComponenteCurricularSalvo,
  CurriculoRepository,
  EstruturaCurricularSalva,
} from './curriculo.repository';
import { calcularStaleAfter, diretorioDesatualizado } from './stale';
import type { HistoricoRepository } from '../sigaa-engine/historico.repository';
import { SITUACOES_INTEGRALIZADAS } from '../sigaa-engine/parsers/historico';
import {
  montarVizinhos,
  type HistoricoParaVizinhos,
  type VizinhosCurriculares,
} from './vizinhos-curriculares';

const LISTA_PATH = '/sigaa/public/curso/lista.jsf';
const CURRICULO_PATH = '/sigaa/public/curso/curriculo.jsf';
const RESUMO_PATH = '/sigaa/public/curso/resumo_curriculo.jsf';
// One retry for a detail page that comes back describing another component —
// see buscarDetalheDoComponente.
const TENTATIVAS_DETALHE = 2;

export class SemEstruturaAtivaError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} has no "Ativa" curriculum structure`);
  }
}

export class CursoDesconhecidoError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} is not in the directory`);
    // Explicit, like the other named sigaa-engine errors: SigaaExceptionFilter
    // maps status codes off `exception.name`, which without this would be
    // the inherited "Error" instead of "CursoDesconhecidoError".
    this.name = 'CursoDesconhecidoError';
  }
}

export class ComponenteDesconhecidoError extends Error {
  constructor(codigo: string, cursoId: string) {
    super(
      `Component ${codigo} is not in course ${cursoId}'s active curriculum structure`,
    );
    // Same convention as CursoDesconhecidoError: SigaaExceptionFilter maps
    // status codes off `exception.name`. This distinguishes "root código not
    // found in the active grade" (montarVizinhos devolve null) do caso
    // genuinamente vazio de dependentes/pré-requisitos, que ainda devolve um
    // VizinhosCurriculares válido (com listas vazias).
    this.name = 'ComponenteDesconhecidoError';
  }
}

// Default seguro pro 4º parâmetro do construtor — "sem histórico
// persistido" é uma resposta válida (vira tudo bloqueada por padrão em
// vizinhosCurriculares), então os testes de listarCursos/resolverCurso/
// resolverPorNomeUsuario que não passam um 4º argumento continuam
// funcionando sem tocar. Produção nunca usa este default: curriculo.module.ts
// sempre injeta o HistoricoRepository real.
const HISTORICO_REPOSITORY_AUSENTE: HistoricoRepository = {
  buscar: async () => null,
  salvar: async () => undefined,
  reconciliarPlano: async () => undefined,
};

export class CurriculoService {
  private readonly logger = new Logger(CurriculoService.name);

  constructor(
    private readonly http: SigaaHttpClient,
    private readonly repository: CurriculoRepository,
    private readonly agora: () => Date = () => new Date(),
    private readonly historicoRepository: HistoricoRepository = HISTORICO_REPOSITORY_AUSENTE,
  ) {}

  /** Refreshes the directory when it has never been populated, or has gone stale. */
  async listarCursos(): Promise<CursoListaItem[]> {
    const existentes = await this.repository.buscarCursos();
    if (existentes.length > 0) {
      const atualizadoEm = await this.repository.buscarDiretorioAtualizadoEm();
      if (atualizadoEm && !diretorioDesatualizado(atualizadoEm, this.agora())) {
        return existentes;
      }
    }
    const resposta = await this.http.request({ method: 'GET', path: LISTA_PATH });
    if (resposta.status !== 200) {
      throw new Error(`lista.jsf → ${resposta.status}`);
    }
    const cursos = parseCursoLista(resposta.body);
    await this.repository.salvarCursos(cursos);
    return cursos;
  }

  /**
   * Resolves and persists a course's active curriculum structure. Serves the
   * cached row only when it is still fresh (`staleAfter` in the future) —
   * a stale row falls through to a real re-resolution, per the design
   * spec's "missing or stale" invalidation rule.
   */
  async resolverCurso(cursoId: string): Promise<EstruturaCurricularSalva> {
    const jaSalva = await this.repository.buscarEstrutura(cursoId);
    if (jaSalva && jaSalva.staleAfter > this.agora()) {
      return jaSalva;
    }

    const curso = await this.repository.buscarCursoPorId(cursoId);
    if (!curso) {
      throw new CursoDesconhecidoError(cursoId);
    }

    const session = new CurriculoPublicSession(this.http);
    const listaHtml = await session.abrir(`${CURRICULO_PATH}?lc=pt_BR&id=${cursoId}`);
    const estruturas = parseCursoEstruturas(listaHtml);
    const ativa = estruturas.find((e) => e.ativa);
    if (!ativa) {
      throw new SemEstruturaAtivaError(cursoId);
    }

    // A real browser also submits the enclosing form's own hidden fields
    // (e.g. formCurriculosCurso=formCurriculosCurso, nivel=G) alongside the
    // ajax action's own params — without the form-marker field in
    // particular, JSF has no way to tell the form was submitted at all.
    const matrizHtml = await session.postar(CURRICULO_PATH, {
      ...ativa.formFields,
      ...ativa.jsfParams,
    });
    const resumo = parseEstruturaResumo(matrizHtml);

    // Sequential, deliberately: resumo_curriculo.jsf keeps the component it
    // is currently showing in the JSF session, so overlapping detail POSTs
    // get answered with each other's pages. Fetching four at a time is what
    // wrote a grade where runs of components shared one pré-requisito
    // expression — and one component listed itself as its own
    // pré-requisito. Slower to resolve, but the result is the real grade.
    const componentesDetalhados: ComponenteCurricularSalvo[] = [];
    for (const componente of resumo.componentes) {
      componentesDetalhados.push(
        await this.buscarDetalheDoComponente(session, resumo.formFields, componente),
      );
    }

    await this.repository.salvarEstrutura(
      cursoId,
      ativa.jsfParams.id,
      ativa.codigo,
      resumo,
      componentesDetalhados,
      calcularStaleAfter(this.agora()),
    );

    const salva = await this.repository.buscarEstrutura(cursoId);
    if (!salva) {
      throw new Error('Estrutura salva mas não encontrada logo depois.');
    }
    return salva;
  }

  /**
   * One component's detail row, or the same component with every detail field
   * null when it could not be read for real. Two things count as "could not
   * be read": the POST failing, and the page coming back describing a
   * *different* código than the one asked for — SIGAA answers from its own
   * session state, so a mismatch means this is some other component's page.
   * Both fail to absence rather than to a wrong pré-requisito expression: a
   * bogus expression shows the student a lock (or an unlock) that isn't real.
   */
  private async buscarDetalheDoComponente(
    session: CurriculoPublicSession,
    formFields: Record<string, string>,
    componente: EstruturaResumo['componentes'][number],
  ): Promise<ComponenteCurricularSalvo> {
    const { jsfParams, ...componenteSalvo } = componente;
    const semDetalhe: ComponenteCurricularSalvo = {
      ...componenteSalvo,
      unidadeResponsavel: null,
      preRequisito: null,
      coRequisito: null,
      equivalencias: null,
    };

    for (let tentativa = 1; tentativa <= TENTATIVAS_DETALHE; tentativa++) {
      // Only the network call is caught: a parser exception is a programming
      // bug (or a page shape SIGAA never actually serves), not a transient
      // per-component failure, and must not be silently absorbed into the
      // same "treat as absence" path as a genuine fetch failure.
      let detalheHtml: string;
      try {
        // capturarViewState: false — the detail page carries no ViewState of
        // its own and does not advance the JSF conversation; see
        // CurriculoPublicSession.postar's doc comment.
        detalheHtml = await session.postar(
          RESUMO_PATH,
          { ...formFields, ...jsfParams },
          { capturarViewState: false },
        );
      } catch (erro) {
        this.logger.warn(
          `Falha ao buscar detalhe do componente ${componente.codigo}: ${erro}`,
        );
        return semDetalhe;
      }

      const { codigo: codigoDaPagina, ...detalhe } = parseComponenteResumo(detalheHtml);
      if (codigoDaPagina === null || codigoDaPagina === componente.codigo) {
        return { ...componenteSalvo, ...detalhe };
      }
      this.logger.warn(
        `Detalhe pedido para ${componente.codigo} voltou descrevendo ${codigoDaPagina} ` +
          `(tentativa ${tentativa}/${TENTATIVAS_DETALHE})`,
      );
    }

    this.logger.error(
      `Descartando o detalhe de ${componente.codigo}: nenhuma tentativa devolveu a página dele.`,
    );
    return semDetalhe;
  }

  /**
   * `User.curso` reads e.g. "ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador" for
   * a real undergrad's own profile (captured in
   * sigaa-engine/parsers/__fixtures__/portal-discente-perfil.html) — name,
   * unidade sigla and campus joined by "/" and " - ". Only the name and
   * campus are matched against the directory (the unidade sigla on the
   * profile side does not always agree with lista.jsf's own grouping).
   *
   * That same real fixture is a case in point for why `nome` needs fuzzy,
   * not exact, matching: the profile spells it "ENGENHARIA DE COMPUTAÇÃO"
   * while the real course directory (curso-lista.html) spells the same
   * course "ENGENHARIA DA COMPUTAÇÃO" — SIGAA itself is inconsistent about
   * the connector word. `normalizarNome` strips single-letter-preposition
   * words (de/da/do/das/dos) before comparing so this real-world spelling
   * drift doesn't break the match.
   */
  async resolverPorNomeUsuario(nomeCurso: string): Promise<EstruturaCurricularSalva> {
    const [antesDoTraco] = nomeCurso.split(' - ');
    const [nome] = antesDoTraco.split('/');
    const campus = nomeCurso.split(' - ')[1]?.trim();

    const cursos = await this.listarCursos();
    const normalizado = (s: string) => s.trim().toUpperCase();
    const normalizarNome = (s: string) =>
      normalizado(s)
        .replace(/\b(DE|DA|DO|DAS|DOS)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const encontrado = cursos.find(
      (c) =>
        normalizarNome(c.nome) === normalizarNome(nome) &&
        c.nivel === 'G' &&
        (!campus || normalizado(c.sede) === normalizado(campus)),
    );
    if (!encontrado) {
      throw new CursoDesconhecidoError(nomeCurso);
    }
    return this.resolverCurso(encontrado.idSigaa);
  }

  /**
   * Vizinhos diretos (pré-requisitos + quem desbloqueia) de `codigo` dentro
   * da estrutura curricular já resolvida/persistida de `cursoId`, com a
   * situação do usuário `userId` pra cada um — não dispara scraping ao vivo
   * (mesma regra de cache de `resolverCurso`).
   */
  async vizinhosCurriculares(
    cursoId: string,
    codigo: string,
    userId: string,
  ): Promise<VizinhosCurriculares> {
    const estrutura = await this.resolverCurso(cursoId);
    const historico = await this.historicoParaUsuario(userId);
    return this.montarVizinhosOuFalhar(estrutura.componentes, codigo, cursoId, historico);
  }

  /** Mesma conveniência de resolverPorNomeUsuario, aplicada aos vizinhos. */
  async vizinhosCurricularesPorNomeUsuario(
    nomeCurso: string,
    codigo: string,
    userId: string,
  ): Promise<VizinhosCurriculares> {
    const estrutura = await this.resolverPorNomeUsuario(nomeCurso);
    const historico = await this.historicoParaUsuario(userId);
    return this.montarVizinhosOuFalhar(estrutura.componentes, codigo, nomeCurso, historico);
  }

  /**
   * Sem histórico persistido pro usuário (nunca sincronizou a Trajetória):
   * devolve os dois conjuntos vazios — vizinhos-curriculares.ts nunca inventa
   * cursada/emCurso sem dado real. Uma matéria sem pré-requisito ainda vira
   * liberada mesmo assim; só uma com pré-requisito não satisfeito vira
   * bloqueada nesse cenário.
   */
  private async historicoParaUsuario(userId: string): Promise<HistoricoParaVizinhos> {
    const salva = await this.historicoRepository.buscar(userId);
    if (!salva) {
      return { aprovados: new Set(), matriculados: new Set() };
    }
    const aprovados = new Set(
      salva.historico.cursados
        .filter((c) => SITUACOES_INTEGRALIZADAS.includes(c.situacao))
        .map((c) => c.codigo),
    );
    const matriculados = new Set(
      salva.historico.cursados.filter((c) => c.situacao === 'MATR').map((c) => c.codigo),
    );
    return { aprovados, matriculados };
  }

  private montarVizinhosOuFalhar(
    componentes: Parameters<typeof montarVizinhos>[0],
    codigo: string,
    identificadorCurso: string,
    historico: HistoricoParaVizinhos,
  ): VizinhosCurriculares {
    const vizinhos = montarVizinhos(componentes, codigo, historico);
    if (!vizinhos) {
      throw new ComponenteDesconhecidoError(codigo, identificadorCurso);
    }
    return vizinhos;
  }
}
