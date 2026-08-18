import { decodeIso88591, encodeFormBody } from './http-client';

describe('decodeIso88591', () => {
  it('decodes accented characters correctly as Latin-1, not UTF-8', () => {
    // "inválidos" encoded as ISO-8859-1 bytes (á = 0xE1)
    const bytes = new Uint8Array([
      0x69, 0x6e, 0x76, 0xe1, 0x6c, 0x69, 0x64, 0x6f, 0x73,
    ]);

    expect(decodeIso88591(bytes.buffer)).toBe('inválidos');
  });
});

describe('encodeFormBody', () => {
  it('urlencodes form fields as application/x-www-form-urlencoded', () => {
    const body = encodeFormBody({
      'user.login': 'joao silva',
      'user.senha': 'a&b=c',
    });

    expect(body).toBe('user.login=joao+silva&user.senha=a%26b%3Dc');
  });

  it('produces an empty string for an empty body', () => {
    expect(encodeFormBody({})).toBe('');
  });
});
