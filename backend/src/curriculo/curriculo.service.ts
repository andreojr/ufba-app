import { Logger } from '@nestjs/common';
import { CurriculoPublicSession } from '../sigaa-engine/curriculo-session';
import type { SigaaHttpClient } from '../sigaa-engine/session';
import { parseCursoLista, type CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import { parseCursoEstruturas } from '../sigaa-engine/parsers/curso-estruturas';
import { parseEstruturaResumo } from '../sigaa-engine/parsers/estrutura-resumo';
import { parseComponenteResumo } from '../sigaa-engine/parsers/componente-resumo';
import type {
  ComponenteCurricularSalvo,
  CurriculoRepository,
  EstruturaCurricularSalva,
} from './curriculo.repository';
import { calcularStaleAfter } from './stale';

const LISTA_PATH = '/sigaa/public/curso/lista.jsf';
const CURRICULO_PATH = '/sigaa/public/curso/curriculo.jsf';
const RESUMO_PATH = '/sigaa/public/curso/resumo_curriculo.jsf';
const CONCORRENCIA_COMPONENTES = 4;

export class SemEstruturaAtivaError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} has no "Ativa" curriculum structure`);
  }
}

export class CursoDesconhecidoError extends Error {
  constructor(cursoId: string) {
    super(`Course ${cursoId} is not in the directory`);
  }
}

async function withLimitedConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await run(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class CurriculoService {
  private readonly logger = new Logger(CurriculoService.name);

  constructor(
    private readonly http: SigaaHttpClient,
    private readonly repository: CurriculoRepository,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Refreshes the directory only when it has never been populated. */
  async listarCursos(): Promise<CursoListaItem[]> {
    const existentes = await this.repository.buscarCursos();
    if (existentes.length > 0) {
      return existentes;
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
   * cached row as-is when it exists — this method does not check staleness
   * itself; that is the caller's call (a stale row is still a valid answer,
   * per the design spec's invalidation rule of "served anyway").
   */
  async resolverCurso(cursoId: string): Promise<EstruturaCurricularSalva> {
    const jaSalva = await this.repository.buscarEstrutura(cursoId);
    if (jaSalva) {
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

    const matrizHtml = await session.postar(CURRICULO_PATH, ativa.jsfParams);
    const resumo = parseEstruturaResumo(matrizHtml);

    const componentesDetalhados = await withLimitedConcurrency(
      resumo.componentes,
      CONCORRENCIA_COMPONENTES,
      async (componente): Promise<ComponenteCurricularSalvo> => {
        // Only the network call is caught here: a parser exception is a
        // programming bug (or an unexpected page shape SIGAA never actually
        // serves), not a transient per-component failure, and must not be
        // silently absorbed into the same "treat as absence" path as a
        // genuine fetch failure.
        let detalheHtml: string;
        try {
          detalheHtml = await session.postar(RESUMO_PATH, {
            formulario: 'formulario',
            id: componente.idSigaa,
            publico: 'public',
          });
        } catch (erro) {
          this.logger.warn(
            `Falha ao buscar detalhe do componente ${componente.codigo}: ${erro}`,
          );
          return {
            ...componente,
            unidadeResponsavel: null,
            preRequisito: null,
            coRequisito: null,
            equivalencias: null,
          };
        }
        return { ...componente, ...parseComponenteResumo(detalheHtml) };
      },
    );

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
   * `User.curso` reads e.g. "ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador" —
   * name, unidade sigla and campus joined by "/" and " - ". Only the name and
   * campus are matched against the directory (the unidade sigla on the
   * profile side does not always agree with lista.jsf's own grouping).
   */
  async resolverPorNomeUsuario(nomeCurso: string): Promise<EstruturaCurricularSalva> {
    const [antesDoTraco] = nomeCurso.split(' - ');
    const [nome] = antesDoTraco.split('/');
    const campus = nomeCurso.split(' - ')[1]?.trim();

    const cursos = await this.listarCursos();
    const normalizado = (s: string) => s.trim().toUpperCase();
    const encontrado = cursos.find(
      (c) =>
        normalizado(c.nome) === normalizado(nome) &&
        c.nivel === 'G' &&
        (!campus || normalizado(c.sede) === normalizado(campus)),
    );
    if (!encontrado) {
      throw new CursoDesconhecidoError(nomeCurso);
    }
    return this.resolverCurso(encontrado.idSigaa);
  }
}
