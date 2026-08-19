import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistorico, SITUACOES } from './historico';
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

  it('reads the issue date off the header line', () => {
    const historico = parseHistorico(itens);

    expect(historico.emitidoEm).toBe('2026-08-19');
  });

  it('throws when a header label it depends on is absent', () => {
    // Layout drift must fail loudly. Without this the parser returns an object
    // that looks complete and is wrong, which is the one outcome the spec
    // forbids outright.
    const semCurriculo = itens.filter(
      (item) => !item.texto.startsWith('Currículo:'),
    );

    expect(() => parseHistorico(semCurriculo)).toThrow(/Currículo/);
  });

  it('throws when a numeric header field is not a number', () => {
    const adulterado = itens.map((item) =>
      item.texto === '8' && item.x < 200 ? { ...item, texto: 'oito' } : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/não é um número/);
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

  it('parses every component row in the table', () => {
    const { cursados } = parseHistorico(itens);

    expect(cursados).toHaveLength(49);
  });

  it('parses a plain approved row end to end', () => {
    const { cursados } = parseHistorico(itens);
    const fisica = cursados.find((c) => c.codigo === 'FISD36');

    expect(fisica).toEqual({
      semestre: '2023.1',
      natureza: 'OB',
      codigo: 'FISD36',
      nome: expect.stringContaining('FÍSICA'),
      cargaHoraria: 60,
      nota: 6.8,
      situacao: 'APR',
      docente: expect.stringContaining('(60h)'),
    });
  });

  it('reports a null natureza when the column emits no item at all', () => {
    const { cursados } = parseHistorico(itens);
    const trancados = cursados.filter((c) => c.situacao === 'TRANC');

    // Trancamento rows leave the natureza column empty — not "-", absent.
    expect(trancados.length).toBeGreaterThan(0);
    expect(trancados.every((c) => c.natureza === null)).toBe(true);
  });

  it('reports a null nota when the document prints "--"', () => {
    const { cursados } = parseHistorico(itens);

    for (const componente of cursados) {
      if (componente.situacao === 'TRANC' || componente.situacao === 'MATR') {
        expect(componente.nota).toBeNull();
      }
    }
  });

  it('reports a null docente when the row carries no docente line', () => {
    const { cursados } = parseHistorico(itens);
    const semDocente = cursados.filter((c) => c.docente === null);

    // Exactly one row in the fixture has no docente. Its name must still parse:
    // with no docente line the name sits on the baseline instead of above it.
    expect(semDocente).toHaveLength(1);
    expect(semDocente[0].nome).not.toBe('');
  });

  it('keeps both attempts when the same code recurs across semesters', () => {
    const { cursados } = parseHistorico(itens);
    const repetido = cursados.filter((c) => c.codigo === 'MATA97');

    expect(repetido).toHaveLength(2);
    expect(repetido.map((c) => c.situacao).sort()).toEqual(['REP', 'TRANC']);
  });

  it('gives every row a name and a recognised situação', () => {
    const { cursados } = parseHistorico(itens);

    for (const componente of cursados) {
      expect(componente.nome).not.toBe('');
      expect(SITUACOES).toContain(componente.situacao);
    }
  });

  it('parses every pending obligatory component', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);

    expect(pendentesObrigatorios).toHaveLength(20);
  });

  it('flags a pending component that is being taken right now', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);

    // The section annotates these with "Matriculado"; the screen must keep them
    // out of the planning pool.
    expect(pendentesObrigatorios.filter((p) => p.matriculado)).toHaveLength(4);
  });

  it('keeps both ENADE rows, which share a code but not a name', () => {
    const { pendentesObrigatorios } = parseHistorico(itens);
    const enade = pendentesObrigatorios.filter((p) => p.codigo === 'ENADE');

    // Code alone is not a key here — this is why the natural key carries nome.
    expect(enade).toHaveLength(2);
    expect(new Set(enade.map((p) => p.nome)).size).toBe(2);
    expect(enade.every((p) => p.cargaHoraria === 0)).toBe(true);
  });

  it('parses the workload matrix, including the totals the document asserts', () => {
    const { cargaHoraria } = parseHistorico(itens);

    expect(cargaHoraria.obrigatorias).toEqual({
      exigida: 3150,
      integralizada: 2100,
      pendente: 1050,
    });
    expect(cargaHoraria.optativas).toEqual({
      exigida: 360,
      integralizada: 0,
      pendente: 360,
    });
    expect(cargaHoraria.complementares).toEqual({
      exigida: 100,
      integralizada: 0,
      pendente: 100,
    });
    expect(cargaHoraria.total).toEqual({
      exigida: 3610,
      integralizada: 2100,
      pendente: 1510,
    });
  });

  it('carries equivalências and observações through as raw lines', () => {
    const { equivalencias, observacoes } = parseHistorico(itens);

    // Free-form text the screen may show verbatim; parsing them into structure
    // buys nothing today.
    expect(equivalencias).toHaveLength(1);
    expect(equivalencias[0]).toContain('através de');
    expect(observacoes.length).toBeGreaterThanOrEqual(3);
  });
});
