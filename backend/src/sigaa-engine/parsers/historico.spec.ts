import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistorico, SITUACOES } from './historico';

/** O marcador do documento pra "sem valor registrado" — descartado nos cursados. */
const SEM_RESULTADO = '--';
import type { ItemTexto } from './historico-texto';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'historico-itens.json');
const TITULO_PENDENTES_TEXTO = /Componentes Curriculares Obrigatórios Pendentes:\d+/;

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

  it('reads the course name off the "Curso:" header line', () => {
    const historico = parseHistorico(itens);

    expect(historico.nomeCurso).toBe(
      'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR - BACHARELADO - PRESENCIAL - N',
    );
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

  /**
   * O mesmo histórico com a tabela de pendentes transbordando pra uma quarta
   * página — a forma que a fixture não tem, porque os 20 pendentes dela cabem
   * folgados na página 3, entre o título (y 562) e as Equivalências (y 291).
   *
   * Fiel à ordem do documento: Equivalências e Observações vêm *depois* da
   * tabela, então descem pra página 4 junto com as linhas que transbordaram.
   * A página nova recebe o bloco de cabeçalho que toda página repete e um
   * rodapé próprio, que é o que delimita a seção por cima e por baixo.
   */
  function comPendentesEmDuasPaginas(): ItemTexto[] {
    const CORTE_Y = 380;
    const DESLOCAMENTO_Y = 320;

    const cabecalho = itens.filter(
      (i) => i.pagina === 3 && Math.abs(i.y - 715.23) <= 0.5,
    );
    const rodape = itens.filter((i) => i.pagina === 3 && i.y < 60);
    expect(cabecalho.length).toBeGreaterThan(0);
    expect(rodape.length).toBeGreaterThan(0);

    const transbordou = (i: ItemTexto) =>
      i.pagina === 3 && i.y > 60 && i.y <= CORTE_Y;

    return [
      ...itens.filter((i) => !transbordou(i)),
      ...itens
        .filter(transbordou)
        .map((i) => ({ ...i, pagina: 4, y: i.y + DESLOCAMENTO_Y })),
      ...cabecalho.map((i) => ({ ...i, pagina: 4 })),
      ...rodape.map((i) => ({ ...i, pagina: 4 })),
    ];
  }

  it('reads a pendentes table that spills onto the next page', () => {
    // Sem isto o parser lê só a página do título e para: 13 das 20 linhas, e a
    // invariante de contagem derruba o histórico inteiro. Foi o segundo erro
    // que o histórico de outro aluno produziu em produção, com 34 declarados.
    const emDuasPaginas = comPendentesEmDuasPaginas();

    const { pendentesObrigatorios } = parseHistorico(emDuasPaginas);

    expect(pendentesObrigatorios).toHaveLength(20);
    // A última linha da tabela original é ENADE, e ela está entre as que
    // desceram — prova de que a continuação foi lida, não só a primeira página.
    expect(
      pendentesObrigatorios.filter((p) => p.codigo === 'ENADE'),
    ).toHaveLength(2);
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
    // Pins the leading-dash strip: the document prints each line as "- Semestre...".
    expect(observacoes[0]).toMatch(/^Semestre 2024\.1/);
  });

  it('drops a row whose situação is "--" — no result recorded yet', () => {
    // Real shape, caught in production on another student's transcript: an
    // ENADE row sits in the cursados table with "--" in the situação column.
    // Mutating a TRANC row keeps both invariantes still — it is already outside
    // the integralizada sum and already carries no nota.
    const alvo = itens.find(
      (item) => item.texto === 'TRANC' && item.x >= 532 && item.x < 580,
    );
    expect(alvo).toBeDefined();
    const adulterado = itens.map((item) =>
      item === alvo ? { ...item, texto: SEM_RESULTADO } : item,
    );

    const { cursados } = parseHistorico(adulterado);

    expect(cursados).toHaveLength(parseHistorico(itens).cursados.length - 1);
    expect(cursados.every((c) => SITUACOES.includes(c.situacao))).toBe(true);
  });

  it('throws when a component carries a situação not in the legend', () => {
    // Every "APR" in the situação column band; mutate one row's cell rather
    // than a name that recurs elsewhere in the document.
    const alvo = itens.find((item) => item.texto === 'APR' && item.x >= 532 && item.x < 580);
    const adulterado = itens.map((item) => (item === alvo ? { ...item, texto: 'ZZZ' } : item));

    expect(() => parseHistorico(adulterado)).toThrow(/situação/i);
  });

  it('throws when a nota cell parses to a non-finite number', () => {
    // A plausible PDF shape: "6.8" painted as two text runs ("6" and ".8")
    // inside the nota x-band, exactly as `celula` would join them back with a
    // space ("6 .8"). That starts with a digit but is not a number — it must
    // throw, not persist a NaN that would silently disable the CR invariant
    // below (NaN !== null, so it would enter `comNota`, and
    // `Math.abs(NaN - cr) > 0.0001` is false).
    const alvo = itens.find((item) => item.texto === '6.8' && item.x >= 500 && item.x < 532);
    const adulterado = itens.flatMap((item) =>
      item === alvo
        ? [
            { ...item, texto: '6' },
            { ...item, texto: '.8', x: item.x + 3 },
          ]
        : [item],
    );

    expect(() => parseHistorico(adulterado)).toThrow(/nota .* não é um número/i);
  });

  it('throws when a cursado carries an empty cargaHoraria cell', () => {
    // FISD36's own carga horária cell ("60") removed outright, leaving the
    // cell empty rather than merely wrong — the same silent-zero shape
    // `exigirNumero` already refuses for header fields.
    const semCarga = itens.filter(
      (item) =>
        !(item.texto === '60' && item.x >= 480 && item.x < 500 && Math.abs(item.y - 330.08) < 0.1),
    );

    expect(() => parseHistorico(semCarga)).toThrow(/carga horária .* não é um número/i);
  });

  it('throws when a cursado natureza cell is non-empty but not in the known list', () => {
    // FISD36's own natureza cell ("OB") replaced with a value the legend does
    // not carry — empty stays a legitimate null, but this is not empty.
    const adulterado = itens.map((item) =>
      item.texto === 'OB' && item.x >= 65 && item.x < 90 && Math.abs(item.y - 330.08) < 0.1
        ? { ...item, texto: 'ZZ' }
        : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/natureza/i);
  });

  it('throws when the pendentes section anchor is entirely absent', () => {
    // This is the whole rationale for parsePendentes throwing instead of
    // returning []: an unread section must never masquerade as an empty one.
    const semTitulo = itens.filter((item) => !TITULO_PENDENTES_TEXTO.test(item.texto));

    expect(() => parseHistorico(semTitulo)).toThrow(/pendentes/i);
  });

  it('throws when a row label of the workload matrix is missing', () => {
    const semExigido = itens.filter((item) => item.texto !== 'Exigido');

    expect(() => parseHistorico(semExigido)).toThrow(/quadro de carga horária/i);
  });

  it('throws when a workload matrix row does not have exactly four values', () => {
    // "3610 h" is the obrigatórias/total column of the Exigido row and appears
    // nowhere else in the document.
    const semValor = itens.filter((item) => item.texto !== '3610 h');

    expect(() => parseHistorico(semValor)).toThrow(/esperava 4/i);
  });

  it('throws when the observações section does not have a lower boundary anchor', () => {
    // Rewording the footer's "Para verificar" sentence removes the only anchor
    // that bounds observações — the parser must refuse rather than fall back
    // to a fixed y that would pull the footer (and its token) in.
    const semAncora = itens.map((item) =>
      item.texto.startsWith('Para verificar')
        ? { ...item, texto: 'Este documento pode ser conferido no site oficial.' }
        : item,
    );

    expect(() => parseHistorico(semAncora)).toThrow(/limite inferior/i);
  });

  it('refuses an observações line shaped like the verification token, regardless of discovery', () => {
    // A discovery-independent net: even with the section boundary intact, a
    // token-shaped string inside it must not survive to the parsed object.
    const alvo = itens.find((item) => item.texto.startsWith('- Semestre 2024.1'));
    const adulterado = itens.map((item) =>
      item === alvo ? { ...item, texto: `${item.texto} aaaa1111bb` } : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/verificação/i);
  });

  it('refuses a document whose declared integralizada does not match summed cursados', () => {
    // "2100 h" is the obrigatórias/total Integralizado value; nudging it off
    // the sum the APR rows actually carry must not pass quietly.
    const adulterado = itens.map((item) =>
      item.texto === '2100 h' ? { ...item, texto: '2101 h' } : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/integralizada/i);
  });

  it('refuses a document with graded components but no parseable CR', () => {
    // Dropping the CR value entirely (not just doctoring it) must not resolve
    // to a silently-null CR when graded components exist — that null is only
    // legitimate for a transcript with nothing graded yet.
    const semCr = itens.filter((item) => item.texto !== '8.1597');

    expect(() => parseHistorico(semCr)).toThrow(/não achei o CR/i);
  });

  it('accepts the real document, whose invariants all hold', () => {
    expect(() => parseHistorico(itens)).not.toThrow();
  });

  it('refuses a document whose CR does not match its own component rows', () => {
    // Doctoring one grade breaks the recomputed CR. A parser reading the wrong
    // column would look exactly like this, which is what the check is for.
    const adulterado = itens.map((item) =>
      item.texto === '6.8' ? { ...item, texto: '9.9' } : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/CR/i);
  });

  it('refuses a document whose pending count contradicts its own title', () => {
    const adulterado = itens.map((item) =>
      TITULO_PENDENTES_TEXTO.test(item.texto)
        ? { ...item, texto: item.texto.replace(/:\d+$/, ':99') }
        : item,
    );

    expect(() => parseHistorico(adulterado)).toThrow(/pendente/i);
  });
});
