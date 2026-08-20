import { Logger } from '@nestjs/common';
import { normalizarNomeDocente } from '../sigaa-engine/docente-nome';
import {
  parseDocenteBusca,
  type DocenteBuscaResultado,
} from '../sigaa-engine/parsers/docente-busca';
import { parseDocenteDisciplinas } from '../sigaa-engine/parsers/docente-disciplinas';
import { parseDocentePortal } from '../sigaa-engine/parsers/docente-portal';
import { parseDocenteProducao } from '../sigaa-engine/parsers/docente-producao';
import {
  getPaginaPublica,
  PublicSigaaSession,
} from '../sigaa-engine/public-session';
import type { SigaaHttpClient } from '../sigaa-engine/session';
import type { DocenteRepository, DocenteSalvo } from './docente.repository';
import { mapComLimite } from './concorrencia';
import { calcularSelos, type DocenteSelos } from './selos';
import { calcularStaleAfter } from './stale';

const LIMITE_GETS = 4;

export interface TurmaDocente {
  codigo: string;
  nome: string;
  docente: string;
}

export interface DocenteResumo {
  nomeOriginal: string;
  componentes: { codigo: string; nome: string }[];
  perfil: null | {
    siape: string;
    nome: string;
    departamento: string | null;
    unidade: string | null;
    selos: DocenteSelos;
  };
}

interface Pendente {
  nomeOriginal: string;
  nomeNormalizado: string;
  codigos: string[];
}

export class DocentesService {
  private readonly logger = new Logger(DocentesService.name);

  constructor(
    private readonly repositorio: DocenteRepository,
    private readonly http: SigaaHttpClient,
    private readonly criarSessao: () => PublicSigaaSession,
  ) {}

  async resumoDoSemestre(turmas: TurmaDocente[]): Promise<DocenteResumo[]> {
    // One entry per distinct docente, carrying every course they teach you.
    const porNome = new Map<
      string,
      { nomeOriginal: string; componentes: { codigo: string; nome: string }[] }
    >();
    for (const turma of turmas) {
      const chave = normalizarNomeDocente(turma.docente);
      const entrada = porNome.get(chave) ?? {
        nomeOriginal: turma.docente,
        componentes: [],
      };
      entrada.componentes.push({ codigo: turma.codigo, nome: turma.nome });
      porNome.set(chave, entrada);
    }

    const agora = new Date();
    const lookups = await this.repositorio.buscarLookups([...porNome.keys()]);
    const porNomeNormalizado = new Map(
      lookups.map((l) => [l.nomeNormalizado, l]),
    );

    // A stale row is served, not awaited: a month-old profile is the same data
    // from a page that changes once a term, and waiting on a slow SIGAA would
    // turn "slightly old" into "screen hangs".
    const siapesConhecidos = lookups
      .filter((l): l is typeof l & { siape: string } => l.siape !== null)
      .map((l) => l.siape);

    const cacheados = await this.repositorio.buscarDocentes(siapesConhecidos);
    const porSiape = new Map(cacheados.map((d) => [d.siape, d]));

    const pendentes: Pendente[] = [];
    const resumos: DocenteResumo[] = [];

    for (const [nomeNormalizado, entrada] of porNome) {
      const lookup = porNomeNormalizado.get(nomeNormalizado);
      const docente = lookup?.siape ? porSiape.get(lookup.siape) : undefined;

      if (lookup && !lookup.siape) {
        // A recorded miss, fresh or stale, is served as perfil: null either
        // way — same rule as a hit. A stale one also fires the full
        // re-resolution (search + profile) in the background, never awaited,
        // mirroring the stale-hit resync below.
        resumos.push({ ...entrada, perfil: null });
        if (lookup.staleAfter <= agora) {
          this.agendarResolucaoPendente({
            nomeOriginal: entrada.nomeOriginal,
            nomeNormalizado,
            codigos: entrada.componentes.map((c) => c.codigo),
          });
        }
        continue;
      }
      if (docente && docente.staleAfter > agora) {
        resumos.push({ ...entrada, perfil: this.paraPerfil(docente) });
        continue;
      }
      if (docente) {
        // Stale, but the siape is already known: resync via the cheap
        // GET-only path — no new session, no repeat search. Serve now, never
        // await the resync.
        resumos.push({ ...entrada, perfil: this.paraPerfil(docente) });
        this.agendarRecarga(docente);
        continue;
      }
      pendentes.push({
        nomeOriginal: entrada.nomeOriginal,
        nomeNormalizado,
        codigos: entrada.componentes.map((c) => c.codigo),
      });
    }

    if (pendentes.length > 0) {
      const resolvidos = await this.resolver(pendentes);
      for (const pendente of pendentes) {
        const entrada = porNome.get(pendente.nomeNormalizado)!;
        const docente = resolvidos.get(pendente.nomeNormalizado);
        resumos.push({
          nomeOriginal: entrada.nomeOriginal,
          componentes: entrada.componentes,
          perfil: docente ? this.paraPerfil(docente) : null,
        });
      }
    }

    return resumos;
  }

  async perfil(siape: string): Promise<DocenteSalvo | null> {
    const [docente] = await this.repositorio.buscarDocentes([siape]);
    if (!docente) {
      return null;
    }
    if (docente.staleAfter <= new Date()) {
      // Serve, then resync outside the request — never awaited.
      this.agendarRecarga(docente);
    }
    return docente;
  }

  /** Fires the GET-only resync in the background; a failure never surfaces. */
  private agendarRecarga(docente: DocenteSalvo): void {
    void this.recarregar(docente).catch((error: unknown) => {
      this.logger.warn(
        `Background resync of docente ${docente.siape} failed`,
        error,
      );
    });
  }

  /**
   * Fires a full re-resolution (new session + search POST) for a stale miss
   * in the background; a failure never surfaces. Unlike `agendarRecarga`,
   * there is no siape to resync from, so this repeats the whole search.
   */
  private agendarResolucaoPendente(pendente: Pendente): void {
    void this.resolver([pendente]).catch((error: unknown) => {
      this.logger.warn(
        `Background re-resolution of ${pendente.nomeOriginal} failed`,
        error,
      );
    });
  }

  private paraPerfil(docente: DocenteSalvo): DocenteResumo['perfil'] {
    return {
      siape: docente.siape,
      nome: docente.nome,
      departamento: docente.departamento,
      unidade: docente.unidade,
      selos: calcularSelos(docente),
    };
  }

  /** Search POSTs are serial: the ViewState chains and cannot be parallelised. */
  private async resolver(
    pendentes: Pendente[],
  ): Promise<Map<string, DocenteSalvo>> {
    const resolvidos = new Map<string, DocenteSalvo>();
    const sessao = this.criarSessao();

    try {
      await sessao.iniciar();
    } catch (error) {
      // SIGAA's public search is unreachable. This must degrade to "no
      // profile for any pendente in this batch", not throw and discard the
      // resumos already built from cache — one outage should not blank a
      // screen that was mostly servable from cache.
      this.logger.warn('Failed to start the public SIGAA session', error);
      return resolvidos;
    }

    const candidatos: {
      pendente: Pendente;
      candidato: DocenteBuscaResultado;
    }[] = [];

    for (const pendente of pendentes) {
      try {
        const html = await sessao.buscar(pendente.nomeNormalizado);
        const resposta = parseDocenteBusca(html);

        if (resposta.tipo === 'erro') {
          // SIGAA rejected the query, or answered with unrecognised HTML
          // (e.g. a maintenance page under a 200). Neither is evidence the
          // docente is absent, so no miss is recorded.
          this.logger.warn(
            `SIGAA rejected the search for ${pendente.nomeOriginal}: ${resposta.mensagem}`,
          );
          continue;
        }

        if (resposta.tipo === 'sem-resultados') {
          // A genuine, explicitly-asserted zero-result: this docente has no
          // public record. Recorded so the name is not re-searched on every
          // screen open. This is the ONLY branch allowed to write siape: null.
          await this.repositorio.salvarLookup({
            nomeNormalizado: pendente.nomeNormalizado,
            nomeOriginal: pendente.nomeOriginal,
            siape: null,
            staleAfter: calcularStaleAfter(new Date()),
          });
          continue;
        }

        if (resposta.docentes.length === 0) {
          // Should be unreachable: parseDocenteBusca only returns `resultados`
          // with a non-empty list (an explicit zero-result comes back as
          // `sem-resultados`). Treated defensively as `erro`, never as a miss.
          this.logger.warn(
            `Unexpected empty 'resultados' for ${pendente.nomeOriginal}; treating as erro`,
          );
          continue;
        }

        const escolhido = await this.escolherCandidato(
          resposta.docentes,
          pendente,
        );
        if (!escolhido) {
          // Candidates exist but none can be singled out. Undecidable is not
          // the same as absent, so this is NOT recorded as a miss — the next
          // open tries again, perhaps with more courses to disambiguate on.
          this.logger.warn(`Could not disambiguate ${pendente.nomeOriginal}`);
          continue;
        }
        candidatos.push({ pendente, candidato: escolhido });
      } catch (error) {
        // Network error, 429, unexpected status: never a miss.
        this.logger.warn(
          `Failed to search for ${pendente.nomeOriginal}`,
          error,
        );
      }
    }

    // Profile pages are stateless, so these can overlap — capped, since nobody
    // has measured the rate limit on the public endpoints.
    const perfis = await mapComLimite(
      candidatos,
      LIMITE_GETS,
      async ({ pendente, candidato }) => {
        try {
          const docente = await this.carregarPerfil(candidato);
          if (!docente) {
            // portal.jsf 302'd for a siape the search just returned — a
            // genuinely inconsistent SIGAA state. Deliberately NOT recorded as
            // a lookup (no siape: null write here): this name will be
            // re-searched on the next open rather than being cached as a
            // permanent miss, which is the safer side to fail on when SIGAA
            // itself is contradicting its own search result.
            return null;
          }
          await this.repositorio.salvarDocente(docente);
          await this.repositorio.salvarLookup({
            nomeNormalizado: pendente.nomeNormalizado,
            nomeOriginal: pendente.nomeOriginal,
            siape: candidato.siape,
            staleAfter: calcularStaleAfter(new Date()),
          });
          return { nomeNormalizado: pendente.nomeNormalizado, docente };
        } catch (error) {
          this.logger.warn(
            `Failed to load the profile of siape ${candidato.siape}`,
            error,
          );
          return null;
        }
      },
    );

    for (const entrada of perfis) {
      if (entrada) {
        resolvidos.set(entrada.nomeNormalizado, entrada.docente);
      }
    }
    return resolvidos;
  }

  /**
   * Exact normalised equality first. The search is a contiguous-substring match,
   * so a name that is a prefix of another returns both (measured: 1 case in
   * 339).
   */
  private async escolherCandidato(
    candidatos: DocenteBuscaResultado[],
    pendente: Pendente,
  ): Promise<DocenteBuscaResultado | null> {
    if (candidatos.length === 0) {
      return null;
    }
    const exatos = candidatos.filter(
      (c) => normalizarNomeDocente(c.nome) === pendente.nomeNormalizado,
    );
    if (exatos.length === 1) {
      return exatos[0];
    }
    if (exatos.length === 0) {
      // No exact match: a single near-match is good evidence (the registry's
      // spelling can differ slightly from the atestado's), but two or more
      // non-exact candidates is a guess, not evidence — staple the wrong
      // stranger's profile onto a real course is worse than showing none, so
      // this refuses instead of picking row 0 arbitrarily.
      return candidatos.length === 1 ? candidatos[0] : null;
    }

    // Homonyms: break the tie on evidence, not on row order. The right siape is
    // the one whose courses-taught page lists a course the student is actually
    // enrolled in. Never observed yet (339 distinct docentes in the sample, no
    // name repeated across siapes), but guessing here would staple a stranger's
    // profile onto a real course, so if the evidence does not single one out we
    // return null and the card renders as "no profile".
    const codigosPendente = new Set(
      pendente.codigos.map((c) => c.trim().toUpperCase()),
    );
    const vencedores = (
      await mapComLimite(exatos, LIMITE_GETS, async (candidato) => {
        const html = await getPaginaPublica(
          this.http,
          `/sigaa/public/docente/disciplinas.jsf?siape=${candidato.siape}`,
        ).catch(() => null);
        if (!html) {
          return null;
        }
        const ensina = parseDocenteDisciplinas(html).some((d) =>
          codigosPendente.has(d.codigo.trim().toUpperCase()),
        );
        return ensina ? candidato : null;
      })
    ).filter((c): c is DocenteBuscaResultado => c !== null);

    return vencedores.length === 1 ? vencedores[0] : null;
  }

  private async carregarPerfil(
    candidato: DocenteBuscaResultado,
  ): Promise<DocenteSalvo | null> {
    const { siape } = candidato;
    // Sequential, not Promise.all: the GET cap (mapComLimite, LIMITE_GETS)
    // only bounds how many candidates load in parallel. Firing all 3 of a
    // single candidate's GETs at once would multiply that ceiling by 3 (up to
    // 12 concurrent requests against a rate limit nobody has measured).
    // Sequential keeps the true peak at LIMITE_GETS.
    const portalHtml = await getPaginaPublica(
      this.http,
      `/sigaa/public/docente/portal.jsf?siape=${siape}`,
    );
    const disciplinasHtml = await getPaginaPublica(
      this.http,
      `/sigaa/public/docente/disciplinas.jsf?siape=${siape}`,
    );
    const producaoHtml = await getPaginaPublica(
      this.http,
      `/sigaa/public/docente/producao.jsf?siape=${siape}`,
    );

    if (!portalHtml) {
      return null;
    }

    const portal = parseDocentePortal(portalHtml);
    const producao = producaoHtml
      ? parseDocenteProducao(producaoHtml)
      : {
          tccsOrientados: [],
          orientacoes: {
            mestradoAndamento: 0,
            mestradoConcluidas: 0,
            doutoradoAndamento: 0,
            doutoradoConcluidas: 0,
          },
        };
    const agora = new Date();

    return {
      siape,
      // The search result is the better source for both. portal.jsf's sidebar
      // carries only the broad instituto, never the specific department — so
      // reading departamento off the profile page would leave every card
      // blank and would throw away the department-over-instituto choice the
      // search parser deliberately makes.
      nome: candidato.nome || portal.nome || '',
      departamento: candidato.departamento ?? portal.departamento,
      unidade: portal.unidade,
      descricaoPessoal: portal.descricaoPessoal,
      formacao: portal.formacao,
      areasInteresse: portal.areasInteresse,
      lattesUrl: portal.lattesUrl,
      enderecoProfissional: portal.enderecoProfissional,
      sala: portal.sala,
      telefone: portal.telefone,
      email: portal.email,
      disciplinas: disciplinasHtml
        ? parseDocenteDisciplinas(disciplinasHtml)
        : [],
      tccsOrientados: producao.tccsOrientados,
      orientacoes: producao.orientacoes,
      fetchedAt: agora,
      staleAfter: calcularStaleAfter(agora),
    };
  }

  /**
   * Background resync of a stale row. Reuses the stored nome/departamento as the
   * candidate: they came from the search result originally, and the profile page
   * cannot supply the specific department.
   */
  private async recarregar(existente: DocenteSalvo): Promise<void> {
    const docente = await this.carregarPerfil({
      siape: existente.siape,
      nome: existente.nome,
      departamento: existente.departamento,
    });
    if (docente) {
      await this.repositorio.salvarDocente(docente);
    }
  }
}
