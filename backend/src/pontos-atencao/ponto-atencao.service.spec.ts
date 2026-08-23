import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PontoAtencaoService } from './ponto-atencao.service';
import type {
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from './ponto-atencao.repository';

function linha(overrides: Partial<PontoAtencaoLinha> = {}): PontoAtencaoLinha {
  return {
    id: 'ponto-1',
    turmaId: 'turma-1',
    turmaCodigo: 'ENGG64',
    turmaNome: 'VISÃO COMPUTACIONAL',
    responsavelId: 'user-2',
    responsavelNome: 'Bruno',
    tipo: 'PROVA',
    titulo: 'Avaliação I',
    data: new Date('2026-09-22T00:00:00Z'),
    hora: '16:40',
    observacao: null,
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    ...overrides,
  };
}

function repositorioFalso(
  overrides: Partial<PontoAtencaoRepository> = {},
): jest.Mocked<PontoAtencaoRepository> {
  return {
    estaMatriculado: jest.fn(() => Promise.resolve(true)),
    listar: jest.fn(() => Promise.resolve([])),
    buscar: jest.fn(() => Promise.resolve(linha())),
    criar: jest.fn(() => Promise.resolve('ponto-1')),
    atualizar: jest.fn(() => Promise.resolve(undefined)),
    apagar: jest.fn(() => Promise.resolve(undefined)),
    votar: jest.fn(() => Promise.resolve(undefined)),
    removerVoto: jest.fn(() => Promise.resolve(undefined)),
    ...overrides,
  } as jest.Mocked<PontoAtencaoRepository>;
}

const DADOS = {
  tipo: 'PROVA' as const,
  titulo: 'Avaliação I',
  data: '2026-09-22',
  hora: '16:40',
  observacao: null,
};

describe('PontoAtencaoService', () => {
  it('recusa criar em turma na qual o usuário não está matriculado', async () => {
    const repo = repositorioFalso({
      estaMatriculado: jest.fn(() => Promise.resolve(false)),
    });

    await expect(
      new PontoAtencaoService(repo).criar('user-1', 'turma-1', DADOS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa edição de item normal por quem não é o responsável', async () => {
    const repo = repositorioFalso();

    await expect(
      new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite edição por qualquer matriculado quando o item está contestado', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(linha({ confirmacoes: 0, contestacoes: 3 })),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalled();
  });

  it('permite edição quando o item ficou sem responsável', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(linha({ responsavelId: null, responsavelNome: null })),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalled();
  });

  it('zera os votos e transfere a responsabilidade quando a data muda', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(linha({ responsavelId: 'user-1' })),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', {
      ...DADOS,
      data: '2026-09-29',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      expect.anything(),
      'user-1',
      true,
    );
  });

  it('preserva os votos quando só a observação muda', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(linha({ responsavelId: 'user-1' })),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', {
      ...DADOS,
      observacao: 'levar calculadora',
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      expect.anything(),
      'user-1',
      false,
    );
  });

  it('recusa apagar item de outra pessoa mesmo estando contestado', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() => Promise.resolve(linha({ contestacoes: 5 }))),
    });

    await expect(
      new PontoAtencaoService(repo).apagar('user-1', 'ponto-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('responde 404 para item que não existe', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() => Promise.resolve(null)),
    });

    await expect(
      new PontoAtencaoService(repo).apagar('user-1', 'ponto-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
