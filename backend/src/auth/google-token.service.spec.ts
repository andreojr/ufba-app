import { TokenPayload } from 'google-auth-library';
import {
  GoogleTokenService,
  GoogleTokenInvalidError,
  GoogleIdTokenVerifier,
} from './google-token.service';

function verifierReturning(
  payload: Record<string, unknown> | undefined,
): GoogleIdTokenVerifier {
  const typedPayload = payload as unknown as TokenPayload | undefined;
  return {
    verifyIdToken: () => Promise.resolve({ getPayload: () => typedPayload }),
  };
}

describe('GoogleTokenService', () => {
  it('returns the user info from a valid token payload', async () => {
    const service = new GoogleTokenService(
      'test-client-id.apps.googleusercontent.com',
      verifierReturning({
        sub: 'google-123',
        email: 'aluno@ufba.br',
        name: 'Aluno Teste',
      }),
    );

    const result = await service.verify('valid-id-token');

    expect(result).toEqual({
      googleId: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
  });

  it('falls back to the email when no name is present in the payload', async () => {
    const service = new GoogleTokenService(
      'test-client-id.apps.googleusercontent.com',
      verifierReturning({ sub: 'google-123', email: 'aluno@ufba.br' }),
    );

    const result = await service.verify('valid-id-token');

    expect(result.name).toBe('aluno@ufba.br');
  });

  it('throws GoogleTokenInvalidError when verification itself throws', async () => {
    const failingVerifier: GoogleIdTokenVerifier = {
      verifyIdToken: () => {
        throw new Error('token expired');
      },
    };
    const service = new GoogleTokenService('test-client-id', failingVerifier);

    await expect(service.verify('bad-token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when the payload has no sub', async () => {
    const service = new GoogleTokenService(
      'test-client-id',
      verifierReturning({ email: 'aluno@ufba.br' }),
    );

    await expect(service.verify('token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when the payload has no email', async () => {
    const service = new GoogleTokenService(
      'test-client-id',
      verifierReturning({ sub: 'google-123' }),
    );

    await expect(service.verify('token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
  });

  it('throws GoogleTokenInvalidError when the payload is undefined', async () => {
    const service = new GoogleTokenService(
      'test-client-id',
      verifierReturning(undefined),
    );

    await expect(service.verify('token')).rejects.toThrow(
      GoogleTokenInvalidError,
    );
  });
});
