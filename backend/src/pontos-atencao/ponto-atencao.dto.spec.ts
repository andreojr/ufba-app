import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CriarPontoAtencaoDto, VotarDto } from './ponto-atencao.dto';

// As mesmas opções que o PontoAtencaoController aplica via @UsePipes — se
// esse pipe divergir das opções daqui, ou sumir, este arquivo é quem nota.
const pipe = new ValidationPipe({ whitelist: true, transform: true });

async function validarCriar(payload: object): Promise<CriarPontoAtencaoDto> {
  return pipe.transform(payload, {
    type: 'body',
    metatype: CriarPontoAtencaoDto,
  }) as Promise<CriarPontoAtencaoDto>;
}

async function validarVotar(payload: object): Promise<VotarDto> {
  return pipe.transform(payload, {
    type: 'body',
    metatype: VotarDto,
  }) as Promise<VotarDto>;
}

const payloadValido = {
  turmaId: 'turma-1',
  tipo: 'PROVA',
  titulo: 'Avaliação I',
  data: '2026-09-22',
  hora: '16:40',
  observacao: 'Sala 204',
};

describe('CriarPontoAtencaoDto (via ValidationPipe)', () => {
  it('aceita um payload válido e devolve os campos esperados', async () => {
    const resultado = await validarCriar(payloadValido);

    expect(resultado).toMatchObject({
      turmaId: 'turma-1',
      tipo: 'PROVA',
      titulo: 'Avaliação I',
      data: '2026-09-22',
      hora: '16:40',
      observacao: 'Sala 204',
    });
  });

  it('rejeita tipo fora de PROVA/TRABALHO', async () => {
    await expect(
      validarCriar({ ...payloadValido, tipo: 'SEMINARIO' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita hora que não bate com HH:MM', async () => {
    await expect(
      validarCriar({ ...payloadValido, hora: '4:5' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita data que não é ISO 8601', async () => {
    await expect(
      validarCriar({ ...payloadValido, data: '22/09/2026' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita título vazio', async () => {
    await expect(
      validarCriar({ ...payloadValido, titulo: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita título acima do tamanho máximo', async () => {
    await expect(
      validarCriar({ ...payloadValido, titulo: 'x'.repeat(121) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove (whitelist) propriedades não declaradas no DTO', async () => {
    const resultado = await validarCriar({
      ...payloadValido,
      responsavelId: 'user-2',
    });

    expect(resultado).not.toHaveProperty('responsavelId');
  });
});

describe('VotarDto (via ValidationPipe)', () => {
  it('rejeita valor fora de CONFIRMA/CONTESTA', async () => {
    await expect(validarVotar({ valor: 'TALVEZ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('aceita um valor válido', async () => {
    const resultado = await validarVotar({ valor: 'CONFIRMA' });
    expect(resultado.valor).toBe('CONFIRMA');
  });
});
