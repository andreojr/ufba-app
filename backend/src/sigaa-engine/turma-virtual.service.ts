import { Logger } from '@nestjs/common';
import type { SigaaSession } from './session';
import type { SigaaSessionFactory } from './sigaa-engine.service';
import { parsePostbackAcessarTurma } from './parsers/turma-virtual/entrar-turma';
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
    super('Esta turma ainda não tem o token da Turma Virtual — sincronize seu horário antes.');
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

  private async entrarNaTurma(
    session: SigaaSession,
    turmaId: string,
  ): Promise<void> {
    const registro = await this.repository.buscarToken(turmaId);
    if (!registro || !registro.frontEndIdTurma) {
      throw new FrontEndIdTurmaAusenteError();
    }
    const portalHtml = await session.get(PORTAL_HOME_PATH);
    const postback = parsePostbackAcessarTurma(portalHtml, registro.frontEndIdTurma);
    await session.postback(PORTAL_HOME_PATH, postback.fields);
  }

  async getFeed(turmaId: string, credenciais: Credenciais): Promise<TurmaVirtualFeed> {
    const session = this.createSession();
    try {
      await session.login(credenciais);
      await this.entrarNaTurma(session, turmaId);

      const [noticiasHtml, avaliacoesHtml, topicosHtml] = await Promise.all([
        session.get(NOTICIAS_PATH),
        session.get(AVALIACOES_PATH),
        session.get(TOPICOS_PATH),
      ]);

      return {
        noticias: parseNoticias(noticiasHtml),
        avaliacoes: parseAvaliacoes(avaliacoesHtml),
        topicos: parseTopicos(topicosHtml),
      };
    } catch (error) {
      if (error instanceof FrontEndIdTurmaAusenteError) {
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
      const html = await session.postback(NOTICIA_DETALHE_PATH, { id: noticiaId });
      return parseNoticiaDetalhe(html);
    } catch (error) {
      if (error instanceof FrontEndIdTurmaAusenteError) {
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
