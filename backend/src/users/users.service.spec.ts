import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

function fakeUserRepository() {
  return {
    upsertGoogleUser: jest.fn(),
    updateAvatarUrl: jest.fn(),
    updateSigaaProfile: jest.fn(),
    findById: jest.fn(),
    deleteAccount: jest.fn(),
  };
}

describe('UsersService erasure', () => {
  it('erases the whole account', async () => {
    const userRepository = fakeUserRepository();
    const service = new UsersService(userRepository);

    await service.eraseAccount('user-uuid-1');

    expect(userRepository.deleteAccount).toHaveBeenCalledWith('user-uuid-1');
  });
});

describe('UsersService.updateAvatar', () => {
  it('saves the avatar URL for the given user', async () => {
    const userRepository = fakeUserRepository();
    const service = new UsersService(userRepository);

    await service.updateAvatar(
      'user-uuid-1',
      'https://api.dicebear.com/9.x/open-peeps/png?seed=abc',
    );

    expect(userRepository.updateAvatarUrl).toHaveBeenCalledWith(
      'user-uuid-1',
      'https://api.dicebear.com/9.x/open-peeps/png?seed=abc',
    );
  });

  it('rejects avatar URLs outside the DiceBear domain', async () => {
    const userRepository = fakeUserRepository();
    const service = new UsersService(userRepository);

    await expect(
      service.updateAvatar('user-uuid-1', 'https://evil.example.com/x.png'),
    ).rejects.toThrow(BadRequestException);
    expect(userRepository.updateAvatarUrl).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL', async () => {
    const userRepository = fakeUserRepository();
    const service = new UsersService(userRepository);

    await expect(
      service.updateAvatar('user-uuid-1', 'not-a-url'),
    ).rejects.toThrow(BadRequestException);
    expect(userRepository.updateAvatarUrl).not.toHaveBeenCalled();
  });
});

describe('UsersService.getMe', () => {
  it('returns the user record found by id', async () => {
    const me = {
      id: 'user-uuid-1',
      email: 'a@ufba.br',
      name: 'A',
      avatarUrl: null,
      matricula: '223116037',
      curso: 'ENGENHARIA DE COMPUTAÇÃO',
      periodoIngresso: '2022.1',
    };
    const userRepository = fakeUserRepository();
    userRepository.findById.mockResolvedValue(me);
    const service = new UsersService(userRepository);

    await expect(service.getMe('user-uuid-1')).resolves.toEqual(me);
    expect(userRepository.findById).toHaveBeenCalledWith('user-uuid-1');
  });

  it('throws NotFoundException when the user no longer exists', async () => {
    const userRepository = fakeUserRepository();
    userRepository.findById.mockResolvedValue(null);
    const service = new UsersService(userRepository);

    await expect(service.getMe('ghost')).rejects.toThrow(NotFoundException);
  });
});
