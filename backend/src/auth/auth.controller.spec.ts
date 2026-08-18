import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('delegates to AuthService.loginWithGoogle with the DTO idToken', async () => {
    const authService = {
      loginWithGoogle: jest
        .fn()
        .mockResolvedValue({ accessToken: 'jwt', user: {} }),
    };
    const controller = new AuthController(authService as any);

    const result = await controller.google({ idToken: 'the-id-token' });

    expect(authService.loginWithGoogle).toHaveBeenCalledWith('the-id-token');
    expect(result).toEqual({ accessToken: 'jwt', user: {} });
  });
});
