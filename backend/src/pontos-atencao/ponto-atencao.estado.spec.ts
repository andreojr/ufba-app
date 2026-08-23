import { estadoDoPonto } from './ponto-atencao.estado';

describe('estadoDoPonto', () => {
  it('é normal sem voto nenhum', () => {
    expect(estadoDoPonto(0, 0)).toBe('NORMAL');
  });

  it('é normal com duas contestações — abaixo do limiar', () => {
    expect(estadoDoPonto(0, 2)).toBe('NORMAL');
  });

  it('vira contestado na terceira contestação', () => {
    expect(estadoDoPonto(0, 3)).toBe('CONTESTADO');
  });

  it('segue normal quando as confirmações empatam com as contestações', () => {
    expect(estadoDoPonto(3, 3)).toBe('NORMAL');
  });

  it('vira contestado quando as contestações passam as confirmações', () => {
    expect(estadoDoPonto(3, 4)).toBe('CONTESTADO');
  });
});
