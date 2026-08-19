import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistorico } from './historico';
import type { ItemTexto } from './historico-texto';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'historico-itens.json');

describe('parseHistorico', () => {
  const itens = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as ItemTexto[];

  it('reads the academic indices straight off the header', () => {
    const historico = parseHistorico(itens);

    // The document prints both; CR is the coefficient the screen shows. IAP is
    // on a 0–1 scale and its formula was never reverse-engineered — it is
    // carried through as-is.
    expect(historico.indices.cr).toBeCloseTo(8.1597, 4);
    expect(historico.indices.iap).toBeCloseTo(0.8434, 4);
  });

  it('reads the vínculo fields the screen needs to bound a planning horizon', () => {
    const historico = parseHistorico(itens);

    expect(historico.curriculo).toBe('G20251 - 2025.2');
    expect(historico.periodoLetivoAtual).toBe(8);
    expect(historico.prazoConclusaoPadrao).toBe('2030.1');
    expect(historico.prazoConclusaoMaximo).toBe('2033.1');
  });

  it('reads the issue date and the verification code from the footer', () => {
    const historico = parseHistorico(itens);

    expect(historico.emitidoEm).toBe('2026-08-19');
  });

  it('does not carry the document authenticity token', () => {
    const historico = parseHistorico(itens);

    // The footer's verification code is deliberately not parsed. Together with a
    // matrícula and an issue date it lets anyone fetch the real transcript from
    // SIGAA's public verification page, and no screen has any use for it — so
    // storing it would be liability without purpose, and would contradict what
    // the sync screen tells the student we keep.
    //
    // Two assertions, not a shape match: a bare /[0-9a-z]{10}/ over the
    // serialised object matches the object's own key names ("obrigatorias" is
    // twelve lowercase letters) and would fail on perfectly good data.
    expect(Object.keys(historico)).not.toContain('codigoVerificacao');
    expect(JSON.stringify(historico)).not.toContain('aaaa1111bb');
  });

  it('never surfaces the personal data the screen has no use for', () => {
    const historico = parseHistorico(itens);

    // CPF, RG and birth date are read past on purpose — see the spec's
    // privacy section. This asserts the shape stays free of them.
    expect(Object.keys(historico)).not.toContain('cpf');
    expect(JSON.stringify(historico)).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });
});
