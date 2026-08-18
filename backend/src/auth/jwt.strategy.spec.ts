import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  it('maps the JWT payload to the request user shape', async () => {
    const strategy = new JwtStrategy('test-secret');

    const result = await strategy.validate({
      sub: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });

    expect(result).toEqual({
      userId: 'google-123',
      email: 'aluno@ufba.br',
      name: 'Aluno Teste',
    });
  });
});
