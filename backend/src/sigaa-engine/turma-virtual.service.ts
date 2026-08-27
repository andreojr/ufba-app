import { Logger } from '@nestjs/common';
import type { SigaaSession } from './session';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';
import type { SigaaSessionFactory } from './sigaa-engine.service';
import { parsePostbackAcessarTurma } from './parsers/turma-virtual/entrar-turma';
import { assertPaginaDaTurmaVirtual } from './parsers/turma-virtual/ava-page';
import { parseTurmaVirtualTokens } from './parsers/turma-virtual-tokens';
import { parseNoticias, NoticiaResumo } from './parsers/turma-virtual/noticias';
import {
  parseNoticiaDetalhe,
  NoticiaDetalhe,
} from './parsers/turma-virtual/noticia-detalhe';
import { parseAvaliacoes, Avaliacao } from './parsers/turma-virtual/avaliacoes';
import { parseTopicos, Topico } from './parsers/turma-virtual/topicos';
import type { TurmaVirtualRepository } from './turma-virtual.repository';

const PORTAL_HOME_PATH = '/sigaa/portais/discente/discente.jsf';
const NOTICIAS_PATH = '/sigaa/ava/NoticiaTurma/listar.jsf';
const NOTICIA_DETALHE_PATH = '/sigaa/ava/NoticiaTurma/mostrar.jsf';
const AVALIACOES_PATH = '/sigaa/ava/DataAvaliacao/listar.jsf';
const TOPICOS_PATH = '/sigaa/ava/Relatorios/timeline.jsf';

export interface TurmaVirtualFeed {
  noticias: NoticiaResumo[];
  avaliacoes: Avaliacao[];
  topicos: Topico[];
}

interface Credenciais {
  login: string;
  senha: string;
}

/** A turma nunca sincronizou o token — o cliente deve reorientar pra sincronizar o horário primeiro. */
export class FrontEndIdTurmaAusenteError extends Error {
  constructor() {
    super(
      'Esta turma ainda não tem o token da Turma Virtual — sincronize seu horário antes.',
    );
    this.name = 'FrontEndIdTurmaAusenteError';
  }
}

/** SIGAA respondeu, mas não com o que qualquer parser desta feature esperava. */
export class SigaaTurmaVirtualIndisponivelError extends Error {
  constructor(cause?: unknown) {
    super('Não foi possível ler a Turma Virtual agora.');
    this.name = 'SigaaTurmaVirtualIndisponivelError';
    this.cause = cause;
  }
}

export class TurmaVirtualService {
  private readonly logger = new Logger(TurmaVirtualService.name);

  constructor(
    private readonly createSession: SigaaSessionFactory,
    private readonly repository: TurmaVirtualRepository,
  ) {}

  /**
   * Entra na Turma Virtual daquela turma e valida que a resposta é de fato o
   * AVA.
   *
   * Ordem de preferência do token, deliberada:
   *
   * 1. O `frontEndIdTurma` do form cujo **nome** bate com o da turma na home
   *    do portal recém-lida — mesmo casamento por nome que o `fetchSchedule`
   *    já faz na sincronização (o link real não carrega o código do
   *    componente, só o nome — confirmado contra sigaa.ufba.br). É a fonte
   *    de verdade porque (a) a estabilidade do token entre sessões nunca foi
   *    testada (item 3 de "Aberto" na investigação) e (b) `Turma` é linha
   *    compartilhada entre todos os alunos daquela turma, então o token
   *    guardado pode ter vindo do render de *outro* aluno e não casar com o
   *    deste.
   * 2. O token guardado, quando nenhum form da home casa com o nome.
   *
   * Só quando as duas falham é que a turma realmente não tem por onde entrar.
   */
  private async entrarNaTurma(
    session: SigaaSession,
    turmaId: string,
  ): Promise<void> {
    const registro = await this.repository.buscarToken(turmaId);
    if (!registro) {
      throw new FrontEndIdTurmaAusenteError();
    }
    const portalHtml = await session.get(PORTAL_HOME_PATH);
    const fresco = parseTurmaVirtualTokens(portalHtml).find(
      (token) => token.nome === registro.nome.trim(),
    );
    const frontEndIdTurma = fresco?.frontEndIdTurma ?? registro.frontEndIdTurma;
    if (!frontEndIdTurma) {
      throw new FrontEndIdTurmaAusenteError();
    }
    const postback = parsePostbackAcessarTurma(portalHtml, frontEndIdTurma);
    const html = await session.postback(PORTAL_HOME_PATH, postback.fields);
    // O postback pode devolver 200 com a home do portal de volta em vez do AVA
    // (gotcha 1). Falhar aqui é muito melhor que deixar os parsers de seção
    // lerem páginas erradas ou vazias mais adiante.
    assertPaginaDaTurmaVirtual(html, 'a página principal da turma');
  }

  /**
   * Erros de domínio do SIGAA já sabem o próprio status (401 de credencial
   * inválida ou sessão expirada, 429 de rate limit) e o filtro de exceções já
   * mapeia cada um — embrulhar tudo em SigaaTurmaVirtualIndisponivelError
   * (503) escondia uma senha desatualizada atrás de "não foi possível ler a
   * Turma Virtual". Mesmo raciocínio (e mesma lista) do fetchSchedule.
   */
  private static erroDeDominio(error: unknown): boolean {
    return (
      error instanceof FrontEndIdTurmaAusenteError ||
      error instanceof SigaaRateLimitedError ||
      error instanceof SigaaSessionExpiredError ||
      error instanceof SigaaInvalidCredentialsError ||
      error instanceof SigaaCredentialsRequiredError
    );
  }

  async getFeed(
    turmaId: string,
    credenciais: Credenciais,
  ): Promise<TurmaVirtualFeed> {
    const session = this.createSession();
    try {
      await session.login(credenciais);
      await this.entrarNaTurma(session, turmaId);

      // Sequencial de propósito, não em Promise.all: se a sessão expirar no
      // meio, o authenticatedRequest da SigaaSession faz relogin e retry
      // internamente, e três requests concorrentes disparariam isso cada um
      // por si, correndo em cima do cookie e do ViewState compartilhados. São
      // três GETs leves — o paralelismo não paga esse risco.
      const noticiasHtml = await session.get(NOTICIAS_PATH);
      const avaliacoesHtml = await session.get(AVALIACOES_PATH);
      const topicosHtml = await session.get(TOPICOS_PATH);

      return {
        noticias: parseNoticias(noticiasHtml),
        avaliacoes: parseAvaliacoes(avaliacoesHtml),
        topicos: parseTopicos(topicosHtml),
      };
    } catch (error) {
      if (TurmaVirtualService.erroDeDominio(error)) {
        throw error;
      }
      this.logger.warn(
        `Falha ao ler a Turma Virtual de ${turmaId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new SigaaTurmaVirtualIndisponivelError(error);
    }
  }

  async getNoticiaDetalhe(
    turmaId: string,
    noticiaId: string,
    credenciais: Credenciais,
  ): Promise<NoticiaDetalhe> {
    const session = this.createSession();
    try {
      await session.login(credenciais);
      await this.entrarNaTurma(session, turmaId);
      const html = await session.postback(NOTICIA_DETALHE_PATH, {
        id: noticiaId,
      });
      return parseNoticiaDetalhe(html);
    } catch (error) {
      if (TurmaVirtualService.erroDeDominio(error)) {
        throw error;
      }
      this.logger.warn(
        `Falha ao ler a notícia ${noticiaId} da turma ${turmaId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new SigaaTurmaVirtualIndisponivelError(error);
    }
  }
}
