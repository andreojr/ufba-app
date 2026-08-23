import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleTokenInvalidError } from './google-token.service';
import { UserRecord } from '../users/user.repository';

function fakeGoogleTokenService(result: {
  googleId: string;
  email: string;
  name: string;
}) {
  return { verify: jest.fn().mockResolvedValue(result) };
}

function fakeJwtService() {
  return { sign: jest.fn().mockReturnValue('signed.jwt.token') };
}

function fakeUserRepository(userRecord: UserRecord) {
  return {
    upsertGoogleUser: jest.fn().mockResolvedValue(userRecord),
    updateAvatarUrl: jest.fn(),
    findById: jest.fn(),
    updateSigaaProfile: jest.fn(),
    deleteAccount: jest.fn(),
  };
}

describe('AuthService.loginWithGoogle', () => {
  it('upserts the UFBA user and signs the JWT with the internal user id', async () => {
    const googleTokenService = fakeGoogleTokenService({
      googleId: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
    const jwtService = fakeJwtService();
    const userRepository = fakeUserRepository({
      id: 'user-uuid-1',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
      avatarUrl: null,
      matricula: null,
      curso: null,
      periodoIngresso: null,
    });
    const authService = new AuthService(
      googleTokenService as any,
      jwtService as any,
      userRepository,
    );

    const result = await authService.loginWithGoogle('some-id-token');

    expect(googleTokenService.verify).toHaveBeenCalledWith('some-id-token');
    expect(userRepository.upsertGoogleUser).toHaveBeenCalledWith({
      googleId: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'user-uuid-1',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: {
        id: 'user-uuid-1',
        email: 'aluno@ufba.br',
        name: 'Aluno Teste',
        avatarUrl: null,
        matricula: null,
        curso: null,
        periodoIngresso: null,
      },
    });
  });

  it('propagates GoogleTokenInvalidError without issuing a JWT', async () => {
    const googleTokenService = {
      verify: jest.fn().mockRejectedValue(new GoogleTokenInvalidError()),
    };
    const jwtService = fakeJwtService();
    const userRepository = fakeUserRepository({
      id: 'user-uuid-1',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
      avatarUrl: null,
      matricula: null,
      curso: null,
      periodoIngresso: null,
    });
    const authService = new AuthService(
      googleTokenService as any,
      jwtService as any,
      userRepository,
    );

    await expect(authService.loginWithGoogle('bad-token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(userRepository.upsertGoogleUser).not.toHaveBeenCalled();
  });

  it('rejects Google accounts outside the @ufba.br domain without issuing a JWT or persisting the user', async () => {
    const googleTokenService = fakeGoogleTokenService({
      googleId: 'google-999',
      email: 'pessoa@gmail.com',
      name: 'Pessoa Qualquer',
    });
    const jwtService = fakeJwtService();
    const userRepository = fakeUserRepository({
      id: 'user-uuid-2',
      email: 'pessoa@gmail.com',
      name: 'Pessoa Qualquer',
      avatarUrl: null,
      matricula: null,
      curso: null,
      periodoIngresso: null,
    });
    const authService = new AuthService(
      googleTokenService as any,
      jwtService as any,
      userRepository,
    );

    await expect(authService.loginWithGoogle('some-id-token')).rejects.toThrow(
      ForbiddenException,
    );
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(userRepository.upsertGoogleUser).not.toHaveBeenCalled();
  });
});
