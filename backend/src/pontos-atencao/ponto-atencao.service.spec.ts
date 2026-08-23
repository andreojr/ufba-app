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

  it('permite edição por qualquer matriculado quando o item está contestado, e transfere a responsabilidade para quem corrigiu a data', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(
          linha({ responsavelId: 'user-2', confirmacoes: 0, contestacoes: 3 }),
        ),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', {
      ...DADOS,
      data: '2026-09-29',
    });

    // O terceiro argumento é o novo responsável: quem corrigiu a data
    // ('user-1'), não quem segurava o item antes ('user-2'). É o prazo que
    // foi contestado, então é ele que precisa ser reafirmado.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      {
        tipo: 'PROVA',
        titulo: 'Avaliação I',
        data: new Date('2026-09-29T00:00:00Z'),
        hora: '16:40',
        observacao: null,
      },
      'user-1',
      true,
    );
  });

  it('permite edição de item contestado por terceiro sem transferir a responsabilidade quando só a observação muda, e não concede podeApagar', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(
          linha({ responsavelId: 'user-2', confirmacoes: 0, contestacoes: 3 }),
        ),
      ),
    });

    const visao = await new PontoAtencaoService(repo).atualizar(
      'user-1',
      'ponto-1',
      { ...DADOS, observacao: 'levar calculadora' },
    );

    // Editar só a observação de um item CONTESTADO não pode virar um jeito
    // indireto de tomar a responsabilidade (e o podeApagar) de outra pessoa:
    // o que foi contestado foi o prazo, não o texto.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      expect.anything(),
      'user-2',
      false,
    );
    expect(visao.responsavelId).toBe('user-2');
    expect(visao.podeApagar).toBe(false);
  });

  it('permite edição quando o item ficou sem responsável, e atribui a responsabilidade a quem corrigiu', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() =>
        Promise.resolve(linha({ responsavelId: null, responsavelNome: null })),
      ),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS);

    // O item estava órfão (responsavelId: null); o terceiro argumento
    // confirma que quem corrigiu ('user-1') vira o novo responsável.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      {
        tipo: 'PROVA',
        titulo: 'Avaliação I',
        data: new Date('2026-09-22T00:00:00Z'),
        hora: '16:40',
        observacao: null,
      },
      'user-1',
      false,
    );
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

  it('lista repassando userId e incluirVencidos sem alterar, mapeando cada linha para a visão', async () => {
    const linhas = [
      linha({ id: 'ponto-1', responsavelId: 'user-1' }),
      linha({ id: 'ponto-2', responsavelId: 'user-2', contestacoes: 3 }),
    ];
    const repo = repositorioFalso({
      listar: jest.fn(() => Promise.resolve(linhas)),
    });

    const visoes = await new PontoAtencaoService(repo).listar('user-1', true);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.listar).toHaveBeenCalledWith('user-1', true);
    expect(visoes).toHaveLength(2);
    expect(visoes[0]).toMatchObject({
      id: 'ponto-1',
      estado: 'NORMAL',
      podeEditar: true,
      podeApagar: true,
    });
    expect(visoes[1]).toMatchObject({
      id: 'ponto-2',
      estado: 'CONTESTADO',
      podeEditar: true,
      podeApagar: false,
    });
  });

  it('recusa votar em item de turma na qual o usuário não está matriculado', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(() => Promise.resolve(null)),
    });

    await expect(
      new PontoAtencaoService(repo).votar('user-1', 'ponto-1', 'CONTESTA'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.votar).not.toHaveBeenCalled();
  });

  it('permite votar a um matriculado que não é o responsável, sem exigir podeEditar', async () => {
    const repo = repositorioFalso();

    await new PontoAtencaoService(repo).votar('user-1', 'ponto-1', 'CONTESTA');

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.votar).toHaveBeenCalledWith('ponto-1', 'user-1', 'CONTESTA');
  });

  it('remove o voto do usuário', async () => {
    const repo = repositorioFalso();

    await new PontoAtencaoService(repo).removerVoto('user-1', 'ponto-1');

    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(repo.removerVoto).toHaveBeenCalledWith('ponto-1', 'user-1');
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
