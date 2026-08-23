import { PrismaUserRepository } from './prisma-user.repository';
import type { PrismaService } from './prisma.service';

/**
 * Records every model method the repository reaches for, so the test can say
 * what was touched *and* what was not. The globals matter here: a deletion
 * that also wiped the shared docente/curso caches would degrade the app for
 * every other student, and the schema gives no cascade to stop it.
 */
function spyingPrisma() {
  const chamadas: string[] = [];
  const modelo = (nome: string) =>
    new Proxy(
      {},
      {
        get: (_alvo, metodo: string) => {
          return jest.fn(() => {
            chamadas.push(`${nome}.${metodo}`);
            return Promise.resolve();
          });
        },
      },
    );

  const prisma = new Proxy(
    {},
    {
      get: (_alvo, nome: string) => modelo(nome),
    },
  );

  return { prisma: prisma as unknown as PrismaService, chamadas };
}

describe('PrismaUserRepository.deleteAccount', () => {
  it('deletes the user row and nothing else, letting the schema cascade the rest', async () => {
    const { prisma, chamadas } = spyingPrisma();

    await new PrismaUserRepository(prisma).deleteAccount('user-1');

    // Exactly one write: every per-user relation declares onDelete: Cascade,
    // and the shared caches (docentes, cursos, estruturas, componentes) hold
    // no user column, so they are not reachable from here at all.
    expect(chamadas).toEqual(['user.delete']);
  });

  it('addresses the row by the id it was given', async () => {
    const deleteSpy = jest.fn();
    const prisma = { user: { delete: deleteSpy } } as unknown as PrismaService;

    await new PrismaUserRepository(prisma).deleteAccount('user-1');

    expect(deleteSpy).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});
