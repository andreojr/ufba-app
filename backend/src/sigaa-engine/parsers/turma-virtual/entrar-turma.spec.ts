import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePostbackAcessarTurma } from './entrar-turma';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'portal-form-acessar.html');

describe('parsePostbackAcessarTurma', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('builds the postback fields for the matching frontEndIdTurma', () => {
    const postback = parsePostbackAcessarTurma(
      html,
      'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
    );

    expect(postback.fields).toEqual({
      form_acessarTurmaVirtual: 'form_acessarTurmaVirtual',
      'form_acessarTurmaVirtual:j_id_jsp_315194548_378':
        'form_acessarTurmaVirtual:j_id_jsp_315194548_378',
      frontEndIdTurma: 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
      'javax.faces.ViewState': '-4021288371482838266:-8988807078783990073',
    });
  });

  it('throws when no form matches the given frontEndIdTurma', () => {
    expect(() => parsePostbackAcessarTurma(html, 'token-inexistente')).toThrow(
      /form_acessarTurmaVirtual/,
    );
  });
});
