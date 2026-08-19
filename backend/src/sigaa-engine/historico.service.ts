import { Logger } from '@nestjs/common';
import type { HistoricoRepository, TrajetoriaSalva } from './historico.repository';
import type { Historico } from './parsers/historico';
import type { ItemTexto } from './parsers/historico-texto';

interface Credenciais {
  login: string;
  senha: string;
}

/** Just the slice of SigaaEngineService this service needs. */
interface DownloaderHistorico {
  fetchHistorico(credenciais: Credenciais): Promise<Buffer>;
}

type Extrator = (pdf: Buffer) => Promise<ItemTexto[]>;
type Parser = (itens: ItemTexto[]) => Historico;

export class HistoricoService {
  private readonly logger = new Logger(HistoricoService.name);

  constructor(
    private readonly downloader: DownloaderHistorico,
    private readonly extrair: Extrator,
    private readonly parse: Parser,
    private readonly repository: HistoricoRepository,
  ) {}

  /**
   * The whole sync, in order: download, extract, parse, persist, reconcile.
   *
   * Nothing is written before the parse succeeds. A parser that cannot make
   * sense of the document throws, and the student's previous snapshot survives
   * untouched — losing a working trajectory to a parser bug would be worse
   * than showing a stale one.
   */
  async sync(userId: string, credenciais: Credenciais): Promise<TrajetoriaSalva> {
    const pdf = await this.downloader.fetchHistorico(credenciais);
    const historico = this.parse(await this.extrair(pdf));

    await this.repository.salvar(userId, historico);
    await this.repository.reconciliarPlano(
      userId,
      historico.pendentesObrigatorios.map((p) => p.codigo),
    );

    this.logger.log(
      `Histórico sincronizado para ${userId}: ` +
        `${historico.cursados.length} componentes, ` +
        `${historico.pendentesObrigatorios.length} pendentes`,
    );

    const salva = await this.repository.buscar(userId);
    if (!salva) {
      throw new Error('Histórico salvo mas não encontrado logo depois.');
    }
    return salva;
  }

  /** Null means the user has never synced — the screen's fallback state. */
  async getTrajetoria(userId: string): Promise<TrajetoriaSalva | null> {
    return this.repository.buscar(userId);
  }
}
