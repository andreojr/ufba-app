import { NotFoundException } from '@nestjs/common';
import { DocentesController } from './docentes.controller';
import type { DocentesService } from './docentes.service';

function servicoFake(
  overrides: Partial<DocentesService> = {},
): DocentesService {
  return {
    resumoDoSemestre: jest.fn().mockResolvedValue([]),
    perfil: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DocentesService;
}

describe('DocentesController', () => {
  it('passes only turmas that name a docente through to the service', async () => {
    const resumoDoSemestre = jest.fn().mockResolvedValue([]);
    const controller = new DocentesController(
      servicoFake({ resumoDoSemestre } as never),
    );

    await controller.semestre({
      turmas: [
        { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
        { codigo: 'MATA59', nome: 'X', docente: '' },
      ],
    });

    expect(resumoDoSemestre).toHaveBeenCalledWith([
      { codigo: 'MATA65', nome: 'CG', docente: 'FULANO' },
    ]);
  });

  it('404s on an unknown siape instead of returning an empty profile', async () => {
    const controller = new DocentesController(servicoFake());
    await expect(controller.detalhe('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the profile for a known siape', async () => {
    const perfil = jest
      .fn()
      .mockResolvedValue({ siape: '1815041', nome: 'FULANO' });
    const controller = new DocentesController(servicoFake({ perfil } as never));
    await expect(controller.detalhe('1815041')).resolves.toMatchObject({
      siape: '1815041',
    });
  });
});
