/**
 * A camada de dados dos pontos de atenção. `PontoAtencaoLinha` já traz as
 * contagens e o voto do próprio usuário porque toda tela precisa dos três
 * juntos — devolver o item cru obrigaria cada chamador a contar votos.
 */
export interface PontoAtencaoLinha {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: Date;
  hora: string | null;
  observacao: string | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: 'CONFIRMA' | 'CONTESTA' | null;
}

export interface DadosPonto {
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: Date;
  hora: string | null;
  observacao: string | null;
}

export interface PontoAtencaoRepository {
  estaMatriculado(userId: string, turmaId: string): Promise<boolean>;
  listar(
    userId: string,
    incluirVencidos: boolean,
  ): Promise<PontoAtencaoLinha[]>;
  buscar(id: string, userId: string): Promise<PontoAtencaoLinha | null>;
  criar(
    turmaId: string,
    responsavelId: string,
    dados: DadosPonto,
  ): Promise<string>;
  atualizar(
    id: string,
    dados: DadosPonto,
    responsavelId: string,
    zerarVotos: boolean,
  ): Promise<void>;
  apagar(id: string): Promise<void>;
  votar(
    pontoId: string,
    userId: string,
    valor: 'CONFIRMA' | 'CONTESTA',
  ): Promise<void>;
  removerVoto(pontoId: string, userId: string): Promise<void>;
}
