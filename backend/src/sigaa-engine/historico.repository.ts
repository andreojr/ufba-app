import type { Historico } from './parsers/historico';

export interface ItemPlano {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null means the unplanned pool. */
  semestre: string | null;
}

export interface TrajetoriaSalva {
  historico: Historico;
  fetchedAt: Date;
  plano: ItemPlano[];
}

export interface HistoricoRepository {
  /**
   * Replaces the user's whole snapshot in one transaction. The PDF is the
   * complete state, so a partial write would mix two documents' rows.
   */
  salvar(userId: string, historico: Historico): Promise<void>;

  /** Null when the user has never synced — the screen's fallback state. */
  buscar(userId: string): Promise<TrajetoriaSalva | null>;

  /**
   * Drops plan items whose component is no longer pending: it has been
   * completed. Called after `salvar`, since the plan is authored data that has
   * to outlive the snapshot it was built from.
   */
  reconciliarPlano(userId: string, codigosPendentes: string[]): Promise<void>;
}
