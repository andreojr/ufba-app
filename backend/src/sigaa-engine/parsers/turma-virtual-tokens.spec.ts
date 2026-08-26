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

  it('captures frontEndIdTurma and idTurmaSigaa keyed by codigo', () => {
    const tokens = parseTurmaVirtualTokens(html);

    expect(tokens).toEqual([
      {
        codigo: 'MATA58',
        frontEndIdTurma: 'AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555',
        idTurmaSigaa: '393380',
      },
      {
        codigo: 'ENGG64',
        frontEndIdTurma: 'FFFF6666GGGG7777HHHH8888IIII9999JJJJ0000',
        idTurmaSigaa: '393381',
      },
    ]);
  });

  it('skips rows with no Turma Virtual link, without throwing', () => {
    const tokens = parseTurmaVirtualTokens(html);

    expect(tokens.find((t) => t.codigo === 'ENGG54')).toBeUndefined();
  });
});
