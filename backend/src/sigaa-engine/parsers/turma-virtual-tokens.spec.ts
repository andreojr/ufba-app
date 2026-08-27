import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurmaVirtualTokens } from './turma-virtual-tokens';

const FIXTURE_PATH = join(
  __dirname,
  '__fixtures__',
  'portal-discente-turma-virtual.html',
);

describe('parseTurmaVirtualTokens', () => {
  const html = readFileSync(FIXTURE_PATH, 'utf-8');

  it('captures frontEndIdTurma keyed by nome (the real SIGAA link has no código, only the course name)', () => {
    const tokens = parseTurmaVirtualTokens(html);

    expect(tokens).toEqual([
      {
        nome: 'SISTEMAS OPERACIONAIS',
        frontEndIdTurma: 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
        idTurmaSigaa: null,
      },
      {
        nome: 'VISÃO COMPUTACIONAL',
        frontEndIdTurma: 'FFFF6666GGGG7777HHHH8888IIII9999JJJJ0000',
        idTurmaSigaa: null,
      },
    ]);
  });

  it('skips rows with no Turma Virtual link, without throwing', () => {
    const tokens = parseTurmaVirtualTokens(html);

    expect(
      tokens.find((t) => t.nome === 'LABORATÓRIO INTEGRADO III-A'),
    ).toBeUndefined();
  });
});
