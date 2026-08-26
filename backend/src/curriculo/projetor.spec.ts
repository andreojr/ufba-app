import type { ItemFila } from './fila-de-pendentes';
import { MAX_SEMESTRES_PROJETADOS, alocar, compactarSemestres, type SemestreProjetado } from './projetor';

function item(codigo: string, extras: Partial<ItemFila> = {}): ItemFila {
  return {
    codigo,
    nome: codigo,
    cargaHoraria: 60,
    periodo: 1,
    atrasada: false,
    preRequisito: null,
    substituto: null,
    ...extras,
  };
}

const SEM_FIXOS = new Map<string, string>();

describe('alocar', () => {
  it('enche o semestre até o teto e transborda para o seguinte', () => {
    const fila = [item('A'), item('B'), item('C')];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 120);

    expect(semestres.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['A', 'B']);
    expect(semestres[1].componentes.map((c) => c.codigo)).toEqual(['C']);
  });

  it('nunca põe uma matéria no mesmo semestre do seu pré-requisito', () => {
    // Teto folgado: se `aprovados` crescesse durante o semestre, as duas
    // caberiam em 2026.2 — e o aluno não pode cursar B antes de passar em A.
    const fila = [item('A'), item('B', { preRequisito: '(A)', periodo: 2 })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 600);

    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['A']);
    expect(semestres[1].componentes.map((c) => c.codigo)).toEqual(['B']);
  });

  it('libera de imediato a matéria cujo pré-requisito o aluno já cursou', () => {
    const fila = [item('B', { preRequisito: '(A)' })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(['A']), '2026.2', 600);

    expect(semestres).toHaveLength(1);
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['B']);
  });

  it('preenche o buraco com a matéria de trás quando a da frente está travada', () => {
    const fila = [item('B', { preRequisito: '(A)' }), item('C', { periodo: 2 })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 600);

    // B depende de A, que ninguém tem e ninguém vai cursar — cai na válvula.
    // C não depende de nada e não precisa esperar por isso.
    expect(semestres[0].componentes.map((c) => c.codigo)).toContain('C');
  });

  it('aloca mesmo assim quando nada é liberado, marcando o não-verificado', () => {
    // Pré-requisito de carga horária mínima: o avaliador reprova por design.
    const fila = [item('A', { preRequisito: 'CH mínima de 1500 horas' })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 600);

    expect(semestres).toHaveLength(1);
    expect(semestres[0].componentes[0]).toMatchObject({
      codigo: 'A',
      preRequisitoNaoVerificado: true,
    });
  });

  it('aloca a matéria maior que o teto em vez de girar para sempre', () => {
    const fila = [item('TCC', { cargaHoraria: 400 })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 120);

    expect(semestres).toHaveLength(1);
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['TCC']);
  });

  it('não deixa a matéria grande demais bloquear as que cabem', () => {
    const fila = [item('TCC', { cargaHoraria: 400 }), item('B', { periodo: 2 })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 120);

    // B entra no primeiro semestre porque cabe; o TCC, que não cabe em teto
    // nenhum, cai na válvula e fica com o seguinte só para ele.
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['B']);
    expect(semestres[1].componentes.map((c) => c.codigo)).toEqual(['TCC']);
  });

  it('respeita a posição fixa do aluno e cobra o teto dela', () => {
    const fila = [item('A'), item('B'), item('C')];
    const fixos = new Map([['C', '2026.2']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 120);

    // C ocupa 60h de 2026.2 por decisão do aluno, então só A cabe junto.
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['C', 'A']);
    expect(semestres[0].componentes[0].manual).toBe(true);
    expect(semestres[1].componentes.map((c) => c.codigo)).toEqual(['B']);
  });

  it('abre os semestres vazios até alcançar uma posição fixa distante', () => {
    const fila = [item('A', { periodo: 1 })];
    const fixos = new Map([['A', '2027.2']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    expect(semestres.map((s) => s.semestre)).toEqual(['2026.2', '2027.1', '2027.2']);
    expect(semestres[0].componentes).toEqual([]);
    expect(semestres[2].componentes.map((c) => c.codigo)).toEqual(['A']);
  });

  it('aloca a posição fixa vencida no primeiro semestre em vez de girar para sempre', () => {
    // O aluno planejou 'A' para 2026.1, o tempo passou e o item continua
    // pendente: o override aponta para um semestre que a sequência a partir
    // de 2026.2 nunca gera. "Já venceu" precisa cair no primeiro semestre.
    const fila = [item('A')];
    const fixos = new Map([['A', '2026.1']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    expect(semestres).toHaveLength(1);
    expect(semestres[0].semestre).toBe('2026.2');
    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['A']);
    expect(semestres[0].componentes[0].manual).toBe(true);
  });

  it('marca preRequisitoNaoVerificado numa posição fixa cujo pré-requisito ainda não foi cursado', () => {
    // O aluno arrastou B1 pro 2026.2 sem ter cursado A1 ainda — o override
    // não passa por avaliarPreRequisito hoje, então isso entrava silencioso.
    // Código com dígito (A1, não A): o regex de avaliarPreRequisito exige
    // letras+dígitos, então um código de teste sem dígito nunca "casa" e o
    // avaliador falha fechado sempre — o que mascararia os dois lados deste
    // teste se eu usasse 'A'/'B' como no resto do arquivo.
    const fila = [item('B1', { preRequisito: '(A1)' })];
    const fixos = new Map([['B1', '2026.2']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    expect(semestres[0].componentes[0]).toMatchObject({
      codigo: 'B1',
      manual: true,
      preRequisitoNaoVerificado: true,
    });
  });

  it('não marca preRequisitoNaoVerificado numa posição fixa cujo pré-requisito já foi cursado', () => {
    const fila = [item('B1', { preRequisito: '(A1)' })];
    const fixos = new Map([['B1', '2026.2']]);
    const semestres = alocar(fila, fixos, new Set(['A1']), '2026.2', 600);

    expect(semestres[0].componentes[0]).toMatchObject({
      codigo: 'B1',
      manual: true,
      preRequisitoNaoVerificado: false,
    });
  });

  it('não marca preRequisitoNaoVerificado numa posição fixa sem pré-requisito', () => {
    const fila = [item('A1')];
    const fixos = new Map([['A1', '2026.2']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    expect(semestres[0].componentes[0].preRequisitoNaoVerificado).toBe(false);
  });

  it('não marca preRequisitoNaoVerificado quando o pré-requisito é cursado num semestre anterior do próprio planejamento, mesmo sem estar no histórico real', () => {
    // A1 nunca foi cursado de verdade (aprovados = vazio) — mas o próprio
    // planejamento aloca A1 em 2026.2 e só depois B1 em 2027.1. Dentro do
    // planejamento que o aluno desenhou, quando ele chegar em B1 ele já terá
    // cursado A1 — a checagem é contra "o que o plano já resolveu até
    // aqui", não contra "o que já foi cursado até hoje".
    const fila = [item('A1'), item('B1', { preRequisito: '(A1)', periodo: 2 })];
    const fixos = new Map([
      ['A1', '2026.2'],
      ['B1', '2027.1'],
    ]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    expect(semestres[0].componentes[0]).toMatchObject({ codigo: 'A1', preRequisitoNaoVerificado: false });
    expect(semestres[1].componentes[0]).toMatchObject({ codigo: 'B1', preRequisitoNaoVerificado: false });
  });

  it('marca preRequisitoNaoVerificado quando o próprio planejamento inverte a ordem do pré-requisito', () => {
    // O oposto do teste acima: o aluno arrastou B1 pra ANTES de A1 dentro do
    // mesmo planejamento — mesmo que A1 esteja planejado (só que depois),
    // na hora de B1 o plano ainda não passou por A1.
    const fila = [item('A1'), item('B1', { preRequisito: '(A1)', periodo: 2 })];
    const fixos = new Map([
      ['A1', '2027.1'],
      ['B1', '2026.2'],
    ]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 600);

    const b1 = semestres.flatMap((s) => s.componentes).find((c) => c.codigo === 'B1');
    expect(b1?.preRequisitoNaoVerificado).toBe(true);
  });

  it('para no teto duro de semestres em vez de projetar milhares deles', () => {
    // O regex do DTO aceita "9999.2". Sem o teto duro, o laço andaria semestre
    // a semestre até lá — quase 16 mil deles, cada um serializado no
    // GET /trajetoria e desenhado pela tela que o aluno usaria para desfazer.
    const fila = [item('A')];
    const fixos = new Map([['A', '9999.2']]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 300);

    expect(semestres).toHaveLength(MAX_SEMESTRES_PROJETADOS);
    // E nada some: o que sobrou cai no último semestre projetado.
    expect(semestres[semestres.length - 1].componentes.map((c) => c.codigo)).toEqual(['A']);
  });

  it('despeja no último semestre tudo que restou ao bater o teto duro', () => {
    // Duas fixas distantes e uma pendente comum: as três precisam aparecer.
    const fila = [item('A'), item('B'), item('C')];
    const fixos = new Map([
      ['A', '9999.1'],
      ['B', '9999.2'],
    ]);
    const semestres = alocar(fila, fixos, new Set(), '2026.2', 300);

    expect(semestres).toHaveLength(MAX_SEMESTRES_PROJETADOS);
    const alocados = semestres.flatMap((s) => s.componentes.map((c) => c.codigo));
    expect(alocados.sort()).toEqual(['A', 'B', 'C']);
    expect(semestres[semestres.length - 1].componentes.map((c) => c.codigo).sort()).toEqual([
      'A',
      'B',
    ]);
  });

  it('deixa a pendente equivalente satisfazer o pré-requisito escrito com o código novo', () => {
    // VELHA2 é a pendente de grade antiga que a grade ativa chama de NOVA2.
    // Cursá-la tem que liberar MATA55 no semestre seguinte, sem válvula.
    const fila = [
      item('VELHA2', { substituto: 'NOVA2', periodo: 1 }),
      item('MATA55', { preRequisito: '(NOVA2)', periodo: 2 }),
      item('OUTRA', { periodo: 3 }),
    ];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 120);

    expect(semestres[0].componentes.map((c) => c.codigo)).toEqual(['VELHA2', 'OUTRA']);
    expect(semestres[1].componentes.map((c) => c.codigo)).toEqual(['MATA55']);
    expect(semestres[1].semestre).toBe('2027.1');
    expect(semestres[1].componentes[0].preRequisitoNaoVerificado).toBe(false);
  });

  it('devolve lista vazia quando não há nada pendente', () => {
    expect(alocar([], SEM_FIXOS, new Set(), '2026.2', 300)).toEqual([]);
  });

  it('carrega o atraso junto do componente, onde quer que ele caia', () => {
    const fila = [item('A', { periodo: 3, atrasada: true }), item('B', { periodo: 7 })];
    const semestres = alocar(fila, SEM_FIXOS, new Set(), '2026.2', 60);

    expect(semestres[0].componentes[0]).toMatchObject({ codigo: 'A', atrasada: true });
    expect(semestres[1].componentes[0]).toMatchObject({ codigo: 'B', atrasada: false });
  });
});

function semestreVazio(semestre: string): SemestreProjetado {
  return { semestre, componentes: [], horasOptativas: 0, horasComplementares: 0 };
}

function semestreCom(semestre: string, codigo: string): SemestreProjetado {
  return {
    semestre,
    componentes: [
      {
        codigo,
        nome: codigo,
        cargaHoraria: 60,
        periodo: 1,
        atrasada: false,
        manual: true,
        preRequisitoNaoVerificado: false,
      },
    ],
    horasOptativas: 0,
    horasComplementares: 0,
  };
}

describe('compactarSemestres', () => {
  it('não mexe em nada quando não há semestre vazio', () => {
    const semestres = [semestreCom('2026.2', 'A'), semestreCom('2027.1', 'B')];
    expect(compactarSemestres(semestres, '2026.2')).toEqual(semestres);
  });

  it('remove um semestre vazio no meio e desloca os seguintes em -1', () => {
    const semestres = [semestreCom('2026.2', 'A'), semestreVazio('2027.1'), semestreCom('2027.2', 'B')];
    const resultado = compactarSemestres(semestres, '2026.2');

    expect(resultado.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
    expect(resultado.map((s) => s.componentes.map((c) => c.codigo))).toEqual([['A'], ['B']]);
  });

  it('remove múltiplos vazios não contíguos', () => {
    const semestres = [
      semestreVazio('2026.2'),
      semestreCom('2027.1', 'A'),
      semestreVazio('2027.2'),
      semestreVazio('2028.1'),
      semestreCom('2028.2', 'B'),
    ];
    const resultado = compactarSemestres(semestres, '2026.2');

    expect(resultado.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
    expect(resultado.map((s) => s.componentes[0].codigo)).toEqual(['A', 'B']);
  });

  it('some com o último semestre quando ele fica vazio, sem deslocar nada', () => {
    const semestres = [semestreCom('2026.2', 'A'), semestreVazio('2027.1')];
    const resultado = compactarSemestres(semestres, '2026.2');

    expect(resultado).toEqual([semestreCom('2026.2', 'A')]);
  });

  it('lista vazia continua vazia', () => {
    expect(compactarSemestres([], '2026.2')).toEqual([]);
  });
});
