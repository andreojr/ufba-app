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
   * Drops plan items whose component is named in `codigosConcluidos`.
   *
   * Deliberately a positive list, not "everything not currently pending":
   * `pendentesObrigatorios` is legitimately empty for a student with nothing
   * obrigatório left (final term, or only optativas/complementares
   * outstanding), and a user-chosen optativa's plan row never had a pending
   * row to begin with — "not pending" would delete both on every routine
   * sync. Only a component that actually finished (see
   * `SITUACOES_INTEGRALIZADAS` in `parsers/historico.ts`) is grounds for
   * dropping a plan row. Called after `salvar`, since the plan is authored
   * data that has to outlive the snapshot it was built from.
   */
  reconciliarPlano(userId: string, codigosConcluidos: string[]): Promise<void>;
}
