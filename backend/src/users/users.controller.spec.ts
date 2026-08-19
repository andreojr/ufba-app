import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('delegates to UsersService.updateAvatar with the current user id and DTO avatarUrl', async () => {
    const usersService = {
      updateAvatar: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new UsersController(usersService as any);

    const result = await controller.updateAvatar(
      { userId: 'user-uuid-1', email: 'a@ufba.br', name: 'A' },
      { avatarUrl: 'https://api.dicebear.com/9.x/open-peeps/png?seed=abc' },
    );

    expect(usersService.updateAvatar).toHaveBeenCalledWith(
      'user-uuid-1',
      'https://api.dicebear.com/9.x/open-peeps/png?seed=abc',
    );
    expect(result).toEqual({
      avatarUrl: 'https://api.dicebear.com/9.x/open-peeps/png?seed=abc',
    });
  });

  it('GET me returns the current user record from UsersService', async () => {
    const me = {
      id: 'user-uuid-1',
      email: 'a@ufba.br',
      name: 'A',
      avatarUrl: null,
      matricula: '223116037',
      curso: 'ENGENHARIA DE COMPUTAÇÃO',
      periodoIngresso: '2022.1',
    };
    const usersService = {
      getMe: jest.fn().mockResolvedValue(me),
    };
    const controller = new UsersController(usersService as any);

    const result = await controller.getMe({
      userId: 'user-uuid-1',
      email: 'a@ufba.br',
      name: 'A',
    });

    expect(usersService.getMe).toHaveBeenCalledWith('user-uuid-1');
    expect(result).toEqual(me);
  });
});
