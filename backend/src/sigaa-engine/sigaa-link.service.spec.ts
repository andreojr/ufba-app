import { SigaaLinkService } from './sigaa-link.service';
import { SigaaInvalidCredentialsError, SigaaSession } from './session';

function fakeSession(loginImpl?: jest.Mock) {
  return {
    login: loginImpl ?? jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    postback: jest.fn(),
  };
}

function fakeVault() {
  return {
    encrypt: jest
      .fn()
      .mockReturnValue({ iv: 'iv', authTag: 'tag', ciphertext: 'cipher' }),
    decrypt: jest.fn(),
  };
}

function fakeRepository() {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findByUserId: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SigaaLinkService.link', () => {
  it('validates the credentials against SIGAA before doing anything else', async () => {
    const session = fakeSession();
    const repository = fakeRepository();
    const service = new SigaaLinkService(
      () => session as unknown as SigaaSession,
      fakeVault() as any,
      repository,
    );

    await service.link('user-1', { login: 'joao', senha: 'segredo' }, false);

    expect(session.login).toHaveBeenCalledWith({
      login: 'joao',
      senha: 'segredo',
    });
  });

  it('propagates SigaaInvalidCredentialsError and never touches the vault or repository', async () => {
    const session = fakeSession(
      jest.fn().mockRejectedValue(new SigaaInvalidCredentialsError()),
    );
    const vault = fakeVault();
    const repository = fakeRepository();
    const service = new SigaaLinkService(
      () => session as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await expect(
      service.link('user-1', { login: 'joao', senha: 'wrong' }, true),
    ).rejects.toThrow(SigaaInvalidCredentialsError);
    expect(vault.encrypt).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('encrypts and persists the password when rememberPassword is true', async () => {
    const vault = fakeVault();
    const repository = fakeRepository();
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await service.link('user-1', { login: 'joao', senha: 'segredo' }, true);

    expect(vault.encrypt).toHaveBeenCalledWith('segredo');
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sigaaLogin: 'joao',
        encryptedSenha: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      }),
    );
  });

  it('never persists the plaintext password anywhere in the saved record', async () => {
    const repository = fakeRepository();
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      fakeVault() as any,
      repository,
    );

    await service.link('user-1', { login: 'joao', senha: 'segredo' }, true);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock call args are untyped
    const saved = JSON.stringify(repository.save.mock.calls[0][0]);
    expect(saved).not.toContain('segredo');
  });

  it('deletes any previously stored credential when rememberPassword is false', async () => {
    const repository = fakeRepository();
    const vault = fakeVault();
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await service.link('user-1', { login: 'joao', senha: 'segredo' }, false);

    expect(vault.encrypt).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.delete).toHaveBeenCalledWith('user-1');
  });
});

describe('SigaaLinkService.getLinkedCredentials', () => {
  it('returns linked: false when no record exists for the user', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue(null);
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      fakeVault() as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).resolves.toEqual({
      linked: false,
    });
  });

  it('decrypts and returns the stored credential when a record exists', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      sigaaLogin: 'joao',
      encryptedSenha: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      linkedAt: new Date('2026-01-01'),
    });
    const vault = fakeVault();
    vault.decrypt.mockResolvedValue('segredo');
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).resolves.toEqual({
      linked: true,
      login: 'joao',
      senha: 'segredo',
    });
    expect(vault.decrypt).toHaveBeenCalledWith(
      { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      { userId: 'user-1', reason: 'mobile-restore' },
    );
  });

  it('propagates a decryption failure without returning partial data', async () => {
    const repository = fakeRepository();
    repository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      sigaaLogin: 'joao',
      encryptedSenha: { iv: 'iv', authTag: 'tag', ciphertext: 'cipher' },
      linkedAt: new Date('2026-01-01'),
    });
    const vault = fakeVault();
    vault.decrypt.mockRejectedValue(new Error('bad key'));
    const service = new SigaaLinkService(
      () => fakeSession() as unknown as SigaaSession,
      vault as any,
      repository,
    );

    await expect(service.getLinkedCredentials('user-1')).rejects.toThrow(
      'bad key',
    );
  });
});
