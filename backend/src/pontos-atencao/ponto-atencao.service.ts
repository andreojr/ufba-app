import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { estadoDoPonto, type EstadoPonto } from './ponto-atencao.estado';
import type {
  DadosPonto,
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from './ponto-atencao.repository';

/** O que chega do cliente: `data` como YYYY-MM-DD, nunca um Date. */
export interface EntradaPonto {
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: string;
  hora: string | null;
  observacao: string | null;
}

export type PontoAtencaoVisao = PontoAtencaoLinha & {
  estado: EstadoPonto;
  podeEditar: boolean;
  podeApagar: boolean;
};

/**
 * A coluna é DATE. Construir com `new Date('2026-09-22')` já dá meia-noite
 * UTC, mas o sufixo explícito evita depender desse detalhe do parser.
 */
function paraData(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function paraDados(entrada: EntradaPonto): DadosPonto {
  return {
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    data: paraData(entrada.data),
    hora: entrada.hora,
    observacao: entrada.observacao,
  };
}

export class PontoAtencaoService {
  constructor(private readonly repository: PontoAtencaoRepository) {}

  private visao(linha: PontoAtencaoLinha, userId: string): PontoAtencaoVisao {
    const estado = estadoDoPonto(linha.confirmacoes, linha.contestacoes);
    return {
      ...linha,
      estado,
      // Contestado destrava a edição: esperar a data certa de quem já errou é
      // esperar de quem demonstrou não saber. Item órfão destrava pelo mesmo
      // motivo — não há mais ninguém para responder por ele.
      podeEditar:
        linha.responsavelId === userId ||
        linha.responsavelId === null ||
        estado === 'CONTESTADO',
      // Apagar é só do responsável em qualquer estado: é a única porta por
      // onde alguém destruiria trabalho alheio sem deixar nada no lugar.
      podeApagar: linha.responsavelId === userId,
    };
  }

  private async exigirMatricula(
    userId: string,
    turmaId: string,
  ): Promise<void> {
    if (!(await this.repository.estaMatriculado(userId, turmaId))) {
      throw new ForbiddenException('Você não está matriculado nesta turma.');
    }
  }

  private async exigirPonto(
    userId: string,
    id: string,
  ): Promise<PontoAtencaoVisao> {
    const linha = await this.repository.buscar(id, userId);
    if (!linha) {
      throw new NotFoundException('Ponto de atenção não encontrado.');
    }
    await this.exigirMatricula(userId, linha.turmaId);
    return this.visao(linha, userId);
  }

  async listar(
    userId: string,
    incluirVencidos: boolean,
  ): Promise<PontoAtencaoVisao[]> {
    const linhas = await this.repository.listar(userId, incluirVencidos);
    return linhas.map((linha) => this.visao(linha, userId));
  }

  async criar(
    userId: string,
    turmaId: string,
    entrada: EntradaPonto,
  ): Promise<PontoAtencaoVisao> {
    await this.exigirMatricula(userId, turmaId);
    const id = await this.repository.criar(turmaId, userId, paraDados(entrada));
    return this.exigirPonto(userId, id);
  }

  async atualizar(
    userId: string,
    id: string,
    entrada: EntradaPonto,
  ): Promise<PontoAtencaoVisao> {
    const atual = await this.exigirPonto(userId, id);
    if (!atual.podeEditar) {
      throw new ForbiddenException(
        'Este item só pode ser editado por quem responde por ele.',
      );
    }

    // O que foi contestado é o prazo, então é ele que precisa ser reafirmado.
    // Zerar em toda edição seria um escape: bastaria mexer na observação para
    // limpar as contestações.
    const prazoMudou =
      atual.data.toISOString().slice(0, 10) !== entrada.data ||
      atual.hora !== entrada.hora;

    await this.repository.atualizar(id, paraDados(entrada), userId, prazoMudou);
    return this.exigirPonto(userId, id);
  }

  async apagar(userId: string, id: string): Promise<void> {
    const atual = await this.exigirPonto(userId, id);
    if (!atual.podeApagar) {
      throw new ForbiddenException('Só quem responde pelo item pode apagá-lo.');
    }
    await this.repository.apagar(id);
  }

  async votar(
    userId: string,
    id: string,
    valor: 'CONFIRMA' | 'CONTESTA',
  ): Promise<PontoAtencaoVisao> {
    await this.exigirPonto(userId, id);
    await this.repository.votar(id, userId, valor);
    return this.exigirPonto(userId, id);
  }

  async removerVoto(userId: string, id: string): Promise<PontoAtencaoVisao> {
    await this.exigirPonto(userId, id);
    await this.repository.removerVoto(id, userId);
    return this.exigirPonto(userId, id);
  }
}
