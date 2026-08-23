import { PontoAtencaoController } from './ponto-atencao.controller';
import type {
  PontoAtencaoService,
  PontoAtencaoVisao,
} from './ponto-atencao.service';

const visao: PontoAtencaoVisao = {
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
  confirmacoes: 2,
  contestacoes: 0,
  meuVoto: null,
  estado: 'NORMAL',
  podeEditar: false,
  podeApagar: false,
};

const usuario = { userId: 'user-1', email: 'a@b.c' };

describe('PontoAtencaoController', () => {
  it('serializa a data como YYYY-MM-DD e não vaza o id do responsável', async () => {
    const service = {
      listar: jest.fn(() => Promise.resolve([visao])),
    } as unknown as PontoAtencaoService;

    const [item] = await new PontoAtencaoController(service).listar(
      usuario as never,
      undefined,
    );

    expect(item.data).toBe('2026-09-22');
    expect(item.responsavel).toEqual({ nome: 'Bruno' });
    expect('responsavelId' in item).toBe(false);
  });

  it('só inclui vencidos quando o parâmetro pede', async () => {
    const service = {
      listar: jest.fn(() => Promise.resolve([])),
    } as unknown as PontoAtencaoService;
    const controller = new PontoAtencaoController(service);

    await controller.listar(usuario as never, undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(service.listar).toHaveBeenLastCalledWith('user-1', false);

    await controller.listar(usuario as never, 'vencidos');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.Mock, não um método de instância
    expect(service.listar).toHaveBeenLastCalledWith('user-1', true);
  });
});
