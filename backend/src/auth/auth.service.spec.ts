import { AuthService } from './auth.service';
import { GoogleTokenInvalidError } from './google-token.service';

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

describe('AuthService.loginWithGoogle', () => {
  it('verifies the Google ID token and returns a Gradline JWT with the user info', async () => {
    const googleTokenService = fakeGoogleTokenService({
      googleId: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
    const jwtService = fakeJwtService();
    const authService = new AuthService(
      googleTokenService as any,
      jwtService as any,
    );

    const result = await authService.loginWithGoogle('some-id-token');

    expect(googleTokenService.verify).toHaveBeenCalledWith('some-id-token');
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
    expect(result).toEqual({
      accessToken: 'signed.jwt.token',
      user: {
        googleId: 'google-123',
        email: 'aluno@ufba.br',
        name: 'Aluno Teste',
      },
    });
  });

  it('propagates GoogleTokenInvalidError without issuing a JWT', async () => {
    const googleTokenService = {
      verify: jest.fn().mockRejectedValue(new GoogleTokenInvalidError()),
    };
    const jwtService = fakeJwtService();
    const authService = new AuthService(
      googleTokenService as any,
      jwtService as any,
    );

    await expect(authService.loginWithGoogle('bad-token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
