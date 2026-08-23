# Projeção da trajetória — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alocar automaticamente as obrigatórias pendentes de cada aluno nos semestres futuros em que ele vai cursá-las, estendendo a linha do tempo da Trajetória até uma linha de chegada concreta.

**Architecture:** Um projetor puro no backend (sem I/O) consome a estrutura curricular já resolvida pelo `TrajetoriaController` e o histórico do aluno, e devolve uma lista de semestres futuros pronta. O mobile só desenha. Os ajustes manuais do aluno viram `PlanoItem` e entram no projetor como posição fixa; a alocação em si nunca é gravada.

**Tech Stack:** NestJS + Prisma (backend), Jest; Expo + React Native + heroui-native (mobile), Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-08-23-projecao-trajetoria-design.md`

## Global Constraints

- **Backend:** rode os testes com `cd backend && npm test`. Um arquivo só: `npm test -- caminho/do.spec.ts`.
- **Mobile:** rode os testes com `cd mobile && npx jest`. Um arquivo só: `npx jest src/caminho/do.test.tsx`.
- **Mobile + RTL:** toda interação que muda estado precisa de `await act(async () => { fireEvent.press(...) })`. `fireEvent.press` solto **não** dispara o re-render neste projeto — o teste passa a mentir. Ver os testes existentes em `mobile/src/__tests__/trajetoria.test.tsx`.
- **Nada de I/O nos módulos de cálculo.** `semestre.ts`, `teto-de-carga.ts`, `fila-de-pendentes.ts` e `projetor.ts` são funções puras: sem Prisma, sem `Date.now()`, sem logger. É o que torna cada caso testável isoladamente.
- **Idioma:** o módulo `curriculo` comenta em português. Siga o arquivo vizinho.
- **`projecao` é best-effort.** Qualquer falha ao montá-la vira `projecao: null` e um `logger.warn` — nunca derruba `GET /trajetoria`. Mesma regra que `marcos` já segue hoje.
- **Situações que contam como concluídas:** use `SITUACOES_INTEGRALIZADAS` de `backend/src/sigaa-engine/parsers/historico.ts` (`APR`, `DISP`, `CUMP`, `INCORP`, `TRANS`). Não escreva `=== 'APR'` à mão.
- **Situações que não contam carga cursada:** `TRANC` e `CANC` — matéria abandonada, o aluno nunca carregou aquela carga até o fim.

---

### Task 1: Aritmética de semestre

Três funções que todo o resto usa. Ficam sozinhas porque `"2026.2" → "2027.1"` aparece em quatro lugares diferentes e não pode divergir entre eles.

**Files:**
- Create: `backend/src/curriculo/semestre.ts`
- Test: `backend/src/curriculo/semestre.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `proximoSemestre(semestre: string): string`, `compararSemestres(a: string, b: string): number`, `distanciaEmSemestres(de: string, ate: string): number`

- [ ] **Step 1: Escreva o teste que falha**

```ts
// backend/src/curriculo/semestre.spec.ts
import {
  compararSemestres,
  distanciaEmSemestres,
  proximoSemestre,
} from './semestre';

describe('proximoSemestre', () => {
  it('avança do primeiro para o segundo período do mesmo ano', () => {
    expect(proximoSemestre('2026.1')).toBe('2026.2');
  });

  it('vira o ano ao passar do segundo período', () => {
    expect(proximoSemestre('2026.2')).toBe('2027.1');
  });
});

describe('compararSemestres', () => {
  it('ordena cronologicamente', () => {
    expect(compararSemestres('2025.2', '2026.1')).toBeLessThan(0);
    expect(compararSemestres('2026.1', '2025.2')).toBeGreaterThan(0);
    expect(compararSemestres('2026.1', '2026.1')).toBe(0);
  });
});

describe('distanciaEmSemestres', () => {
  it('conta os semestres entre dois pontos', () => {
    expect(distanciaEmSemestres('2026.1', '2027.2')).toBe(3);
  });

  it('é zero para o mesmo semestre', () => {
    expect(distanciaEmSemestres('2026.1', '2026.1')).toBe(0);
  });

  it('é negativa quando o alvo já passou — quem chama decide se isso importa', () => {
    expect(distanciaEmSemestres('2027.1', '2026.1')).toBe(-2);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/curriculo/semestre.spec.ts`
Expected: FAIL — `Cannot find module './semestre'`

- [ ] **Step 3: Implemente**

```ts
// backend/src/curriculo/semestre.ts

/**
 * Aritmética dos períodos letivos do SIGAA, que correm ".1" e depois ".2"
 * dentro do mesmo ano. Isolado num módulo próprio porque quatro lugares
 * diferentes precisam avançar um semestre, e duas versões dessa regra
 * divergindo é um bug que só aparece na virada do ano.
 */

function partes(semestre: string): { ano: number; periodo: number } {
  const [ano, periodo] = semestre.split('.').map(Number);
  return { ano, periodo };
}

/** "2026.1" → "2026.2"; "2026.2" → "2027.1". */
export function proximoSemestre(semestre: string): string {
  const { ano, periodo } = partes(semestre);
  return periodo === 1 ? `${ano}.2` : `${ano + 1}.1`;
}

/**
 * Negativo quando `a` vem antes de `b`. O formato "AAAA.N" ordena
 * lexicograficamente por construção, então não há conversão a fazer.
 */
export function compararSemestres(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Quantos semestres separam `de` de `ate`. Negativo quando `ate` já passou —
 * deliberadamente, para que quem chama decida o que fazer com isso em vez de
 * receber um zero que esconde a inversão.
 */
export function distanciaEmSemestres(de: string, ate: string): number {
  const inicio = partes(de);
  const fim = partes(ate);
  return (fim.ano - inicio.ano) * 2 + (fim.periodo - inicio.periodo);
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/curriculo/semestre.spec.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/semestre.ts backend/src/curriculo/semestre.spec.ts
git commit -m "feat(curriculo): aritmética de período letivo"
```

---

### Task 2: Teto de carga horária

Quanto o projetor pode empilhar num semestre. A regra é `min(período mais pesado da grade, recorde do aluno)`, com piso no período mais leve — decisão registrada na spec.

**Files:**
- Create: `backend/src/curriculo/teto-de-carga.ts`
- Test: `backend/src/curriculo/teto-de-carga.spec.ts`

**Interfaces:**
- Consumes: `ComponenteCurricularSalvo` de `./curriculo.repository`, `ComponenteCursado` de `../sigaa-engine/parsers/historico`.
- Produces: `tetoDeCarga(componentes: ComponenteCurricularSalvo[], cursados: ComponenteCursado[]): number`

- [ ] **Step 1: Escreva o teste que falha**

```ts
// backend/src/curriculo/teto-de-carga.spec.ts
import type { ComponenteCursado } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';
import { tetoDeCarga } from './teto-de-carga';

function componente(
  periodo: number | null,
  cargaHoraria: number,
  codigo = `C${periodo}-${cargaHoraria}`,
): ComponenteCurricularSalvo {
  return {
    idSigaa: codigo,
    codigo,
    nome: codigo,
    cargaHoraria,
    natureza: periodo === null ? 'OPTATIVA' : 'OBRIGATORIA',
    periodo,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };
}

function cursado(
  semestre: string,
  cargaHoraria: number,
  situacao: ComponenteCursado['situacao'] = 'APR',
): ComponenteCursado {
  return {
    semestre,
    natureza: 'OB',
    codigo: `${semestre}-${cargaHoraria}-${situacao}`,
    nome: 'MATÉRIA',
    cargaHoraria,
    nota: 8,
    situacao,
    docente: null,
  };
}

// Grade: período 1 com 300h (o mais leve), período 2 com 400h (o mais pesado).
const GRADE = [
  componente(1, 150, 'A1'),
  componente(1, 150, 'A2'),
  componente(2, 200, 'B1'),
  componente(2, 200, 'B2'),
];

describe('tetoDeCarga', () => {
  it('usa o recorde do aluno quando ele fica abaixo do período mais pesado', () => {
    const cursados = [cursado('2025.1', 340)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(340);
  });

  it('não passa do período mais pesado da grade, mesmo com recorde maior', () => {
    const cursados = [cursado('2025.1', 500)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(400);
  });

  it('não desce abaixo do período mais leve, mesmo com um semestre atípico', () => {
    // Um semestre em que ele fechou só 30h travaria a projeção em 2035.
    const cursados = [cursado('2025.1', 30)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(300);
  });

  it('cai no período mais pesado quando o aluno não tem semestre fechado', () => {
    expect(tetoDeCarga(GRADE, [])).toBe(400);
  });

  it('ignora trancadas e canceladas ao medir o recorde', () => {
    // 340h cursadas de verdade + 200h abandonadas não fazem um recorde de 540h.
    const cursados = [
      cursado('2025.1', 340),
      cursado('2025.1', 200, 'TRANC'),
    ];
    expect(tetoDeCarga(GRADE, cursados)).toBe(340);
  });

  it('soma o semestre inteiro, não a maior matéria', () => {
    const cursados = [cursado('2025.1', 100), cursado('2025.1', 220)];
    expect(tetoDeCarga(GRADE, cursados)).toBe(320);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/curriculo/teto-de-carga.spec.ts`
Expected: FAIL — `Cannot find module './teto-de-carga'`

- [ ] **Step 3: Implemente**

```ts
// backend/src/curriculo/teto-de-carga.ts
import type { ComponenteCursado } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';

/**
 * Matéria abandonada no meio não conta como carga carregada: o aluno nunca
 * levou aquelas horas até um resultado. Mesma regra que a tela já aplica em
 * `componentesComCargaHorariaContada`.
 */
const SITUACOES_ABANDONADAS: readonly string[] = ['TRANC', 'CANC'];

/** Carga horária somada de cada período da grade. Optativas não têm período. */
function cargaPorPeriodo(componentes: ComponenteCurricularSalvo[]): number[] {
  const porPeriodo = new Map<number, number>();
  for (const componente of componentes) {
    if (componente.periodo === null) {
      continue;
    }
    porPeriodo.set(
      componente.periodo,
      (porPeriodo.get(componente.periodo) ?? 0) + componente.cargaHoraria,
    );
  }
  return [...porPeriodo.values()];
}

/** A maior carga horária que o aluno já fechou num único semestre. */
function recordeDoAluno(cursados: ComponenteCursado[]): number {
  const porSemestre = new Map<string, number>();
  for (const componente of cursados) {
    if (SITUACOES_ABANDONADAS.includes(componente.situacao)) {
      continue;
    }
    porSemestre.set(
      componente.semestre,
      (porSemestre.get(componente.semestre) ?? 0) + componente.cargaHoraria,
    );
  }
  return Math.max(0, ...porSemestre.values());
}

/**
 * Quanto o projetor pode empilhar num semestre futuro: o menor entre o período
 * mais pesado da grade e o recorde pessoal do aluno.
 *
 * O piso no período mais leve existe por causa de dois modos de falha do
 * recorde, que sozinhos travariam a projeção: o aluno de primeiro período não
 * tem semestre fechado nenhum, e o aluno que teve um semestre atípico de 30h
 * ficaria preso nesse teto pela projeção inteira.
 *
 * Uma grade sem obrigatórias por período (nada de onde tirar pesado/leve) cai
 * no recorde; sem recorde também, devolve zero — e aí a válvula de "matéria
 * maior que o teto ocupa o semestre sozinha", no projetor, é o que garante que
 * a fila ainda anda, um componente por semestre.
 */
export function tetoDeCarga(
  componentes: ComponenteCurricularSalvo[],
  cursados: ComponenteCursado[],
): number {
  const cargas = cargaPorPeriodo(componentes);
  const recorde = recordeDoAluno(cursados);
  if (cargas.length === 0) {
    return recorde;
  }
  const pesado = Math.max(...cargas);
  const leve = Math.min(...cargas);
  if (recorde === 0) {
    return pesado;
  }
  return Math.min(Math.max(recorde, leve), pesado);
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/curriculo/teto-de-carga.spec.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/teto-de-carga.ts backend/src/curriculo/teto-de-carga.spec.ts
git commit -m "feat(curriculo): teto de carga horária por semestre projetado"
```

---

### Task 3: Fila de pendentes

Transforma as pendentes cruas do histórico na fila ordenada que o projetor consome — resolvendo o período de cada uma contra a grade ativa, inclusive por equivalência.

**Files:**
- Create: `backend/src/curriculo/fila-de-pendentes.ts`
- Test: `backend/src/curriculo/fila-de-pendentes.spec.ts`

**Interfaces:**
- Consumes: `ComponenteCurricularSalvo`, `ComponentePendente` de `../sigaa-engine/parsers/historico`.
- Produces:
  ```ts
  export interface ItemFila {
    codigo: string;
    nome: string;
    cargaHoraria: number;
    periodo: number | null;
    atrasada: boolean;
    preRequisito: string | null;
  }
  export function montarFila(
    pendentes: ComponentePendente[],
    componentes: ComponenteCurricularSalvo[],
    equivalencias: { codigo: string; equivalenteDe: string }[],
    periodoLetivoAtual: number,
  ): ItemFila[]
  ```

- [ ] **Step 1: Escreva o teste que falha**

```ts
// backend/src/curriculo/fila-de-pendentes.spec.ts
import type { ComponentePendente } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';
import { montarFila } from './fila-de-pendentes';

function componente(
  codigo: string,
  periodo: number | null,
  extras: Partial<ComponenteCurricularSalvo> = {},
): ComponenteCurricularSalvo {
  return {
    idSigaa: codigo,
    codigo,
    nome: codigo,
    cargaHoraria: 60,
    natureza: 'OBRIGATORIA',
    periodo,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
    ...extras,
  };
}

function pendente(
  codigo: string,
  extras: Partial<ComponentePendente> = {},
): ComponentePendente {
  return { codigo, nome: codigo, cargaHoraria: 60, matriculado: false, ...extras };
}

describe('montarFila', () => {
  it('ordena por período da grade', () => {
    const fila = montarFila(
      [pendente('C'), pendente('A'), pendente('B')],
      [componente('A', 1), componente('B', 2), componente('C', 3)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'B', 'C']);
  });

  it('marca como atrasada a pendente de período já vencido', () => {
    const fila = montarFila(
      [pendente('A'), pendente('B')],
      [componente('A', 3), componente('B', 6)],
      [],
      6,
    );
    expect(fila.find((i) => i.codigo === 'A')?.atrasada).toBe(true);
    // Período 6 com o aluno no 6º não está atrasada: é a do semestre corrente.
    expect(fila.find((i) => i.codigo === 'B')?.atrasada).toBe(false);
  });

  it('herda o período do substituto quando a pendente é equivalente', () => {
    const fila = montarFila(
      [pendente('VELHA2')],
      [componente('NOVA2', 4, { preRequisito: '(MATA01)' })],
      [{ codigo: 'VELHA2', equivalenteDe: 'NOVA2' }],
      6,
    );
    expect(fila[0]).toMatchObject({
      codigo: 'VELHA2',
      periodo: 4,
      atrasada: true,
      preRequisito: '(MATA01)',
    });
  });

  it('joga a obsoleta pura para o fim, sem período e sem atraso', () => {
    const fila = montarFila(
      [pendente('SUMIU'), pendente('A')],
      [componente('A', 5)],
      [],
      6,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'SUMIU']);
    expect(fila[1]).toMatchObject({
      periodo: null,
      atrasada: false,
      preRequisito: null,
    });
  });

  it('exclui quem já está matriculado — a matéria está sendo cursada agora', () => {
    const fila = montarFila(
      [pendente('A', { matriculado: true }), pendente('B')],
      [componente('A', 1), componente('B', 2)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['B']);
  });

  it('exclui as linhas de ENADE, que não são componente curricular', () => {
    const fila = montarFila([pendente('ENADE'), pendente('A')], [componente('A', 1)], [], 1);
    expect(fila.map((i) => i.codigo)).toEqual(['A']);
  });

  it('desempata por código, para a projeção não mudar entre duas leituras', () => {
    const fila = montarFila(
      [pendente('Z'), pendente('A')],
      [componente('A', 2), componente('Z', 2)],
      [],
      1,
    );
    expect(fila.map((i) => i.codigo)).toEqual(['A', 'Z']);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/curriculo/fila-de-pendentes.spec.ts`
Expected: FAIL — `Cannot find module './fila-de-pendentes'`

- [ ] **Step 3: Implemente**

```ts
// backend/src/curriculo/fila-de-pendentes.ts
import type { ComponentePendente } from '../sigaa-engine/parsers/historico';
import type { ComponenteCurricularSalvo } from './curriculo.repository';

/**
 * O histórico lista o ENADE entre os pendentes obrigatórios, mas ele não é
 * componente curricular — não tem período, não tem carga, e planejar em que
 * semestre fazê-lo não quer dizer nada.
 */
const CODIGO_ENADE = 'ENADE';

export interface ItemFila {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null só na obsoleta pura: nenhum componente ativo com esse código. */
  periodo: number | null;
  atrasada: boolean;
  /** Texto cru da grade ativa, para o `avaliarPreRequisito`. */
  preRequisito: string | null;
}

/**
 * A fila que o projetor consome, na ordem em que ele deve tentar alocar.
 *
 * A ordenação por período faz as atrasadas saírem primeiro por construção, sem
 * regra especial: período menor vem antes, e atrasada é justamente a de período
 * menor que o atual.
 *
 * Uma pendente pode não existir na grade ativa, porque o histórico cobra
 * segundo o currículo *do aluno* e nós resolvemos sempre a Ativa. Quando a
 * grade nova declara equivalência, a pendente herda o período do substituto e
 * é alocada com dado real — esse é o caso comum. Quando ninguém a menciona
 * (obsoleta pura), ela vai para o fim da fila sem período: não é atraso, é
 * divergência de catálogo, e não merece o mesmo senso de urgência.
 */
export function montarFila(
  pendentes: ComponentePendente[],
  componentes: ComponenteCurricularSalvo[],
  equivalencias: { codigo: string; equivalenteDe: string }[],
  periodoLetivoAtual: number,
): ItemFila[] {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  const substitutoDe = new Map(equivalencias.map((e) => [e.codigo, e.equivalenteDe]));

  const itens = pendentes
    .filter((p) => !p.matriculado && p.codigo !== CODIGO_ENADE)
    .map((pendente): ItemFila => {
      const substituto = substitutoDe.get(pendente.codigo);
      const naGrade =
        porCodigo.get(pendente.codigo) ??
        (substituto ? porCodigo.get(substituto) : undefined);
      const periodo = naGrade?.periodo ?? null;
      return {
        codigo: pendente.codigo,
        nome: pendente.nome,
        cargaHoraria: pendente.cargaHoraria,
        periodo,
        atrasada: periodo !== null && periodo < periodoLetivoAtual,
        preRequisito: naGrade?.preRequisito ?? null,
      };
    });

  // Sem período vai para o fim. O desempate por código não é estético: sem ele
  // duas leituras seguidas do mesmo histórico podem devolver projeções
  // diferentes, e o aluno vê a timeline se remexer sozinha.
  return itens.sort((a, b) => {
    const periodoA = a.periodo ?? Number.MAX_SAFE_INTEGER;
    const periodoB = b.periodo ?? Number.MAX_SAFE_INTEGER;
    return periodoA - periodoB || a.codigo.localeCompare(b.codigo);
  });
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/curriculo/fila-de-pendentes.spec.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/fila-de-pendentes.ts backend/src/curriculo/fila-de-pendentes.spec.ts
git commit -m "feat(curriculo): fila ordenada de pendentes com período resolvido"
```

---

### Task 4: O projetor

O laço guloso. Consome a fila, respeita pré-requisito e teto, e devolve os semestres futuros. É o coração da entrega e o único lugar onde um bug produz uma projeção plausível e errada — por isso o teste cobre caso a caso.

**Files:**
- Create: `backend/src/curriculo/projetor.ts`
- Test: `backend/src/curriculo/projetor.spec.ts`

**Interfaces:**
- Consumes: `ItemFila` (Task 3), `proximoSemestre` (Task 1), `avaliarPreRequisito` de `./avaliador-prerequisito`.
- Produces:
  ```ts
  export interface ComponenteProjetado {
    codigo: string;
    nome: string;
    cargaHoraria: number;
    periodo: number | null;
    atrasada: boolean;
    manual: boolean;
    preRequisitoNaoVerificado: boolean;
  }
  export interface SemestreProjetado {
    semestre: string;
    componentes: ComponenteProjetado[];
    horasOptativas: number;
    horasComplementares: number;
  }
  export function alocar(
    fila: ItemFila[],
    fixos: ReadonlyMap<string, string>,
    aprovados: ReadonlySet<string>,
    primeiroSemestre: string,
    teto: number,
  ): SemestreProjetado[]
  ```
  `horasOptativas`/`horasComplementares` saem de `alocar` sempre em `0` — quem preenche é a Task 5.

- [ ] **Step 1: Escreva o teste que falha**

```ts
// backend/src/curriculo/projetor.spec.ts
import type { ItemFila } from './fila-de-pendentes';
import { alocar } from './projetor';

function item(codigo: string, extras: Partial<ItemFila> = {}): ItemFila {
  return {
    codigo,
    nome: codigo,
    cargaHoraria: 60,
    periodo: 1,
    atrasada: false,
    preRequisito: null,
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
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/curriculo/projetor.spec.ts`
Expected: FAIL — `Cannot find module './projetor'`

- [ ] **Step 3: Implemente**

```ts
// backend/src/curriculo/projetor.ts
import { avaliarPreRequisito } from './avaliador-prerequisito';
import type { ItemFila } from './fila-de-pendentes';
import { proximoSemestre } from './semestre';

export interface ComponenteProjetado {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  periodo: number | null;
  atrasada: boolean;
  /** Veio de um PlanoItem: o aluno pôs aqui, o projetor não escolheu. */
  manual: boolean;
  /** Alocado pela válvula, sem conseguir confirmar o pré-requisito. */
  preRequisitoNaoVerificado: boolean;
}

export interface SemestreProjetado {
  semestre: string;
  componentes: ComponenteProjetado[];
  /** Sempre 0 aqui — `derramarHorasGenericas` é quem preenche. */
  horasOptativas: number;
  horasComplementares: number;
}

function projetar(item: ItemFila, opcoes: { manual: boolean; naoVerificado: boolean }): ComponenteProjetado {
  return {
    codigo: item.codigo,
    nome: item.nome,
    cargaHoraria: item.cargaHoraria,
    periodo: item.periodo,
    atrasada: item.atrasada,
    manual: opcoes.manual,
    preRequisitoNaoVerificado: opcoes.naoVerificado,
  };
}

/**
 * Distribui a fila pelos semestres futuros. Guloso e determinístico: a cada
 * semestre percorre a fila em ordem e pega tudo que está liberado e cabe.
 *
 * `aprovados` só cresce no **fim** de cada semestre, nunca durante. É isso que
 * impede uma matéria e o pré-requisito dela de caírem juntos: dentro de um
 * semestre, nada que foi alocado ali conta como cursado.
 *
 * O laço precisa terminar, e duas condições ameaçam isso: um semestre em que
 * nada é liberado (pré-requisito citando código fora da grade, ou o texto de
 * "carga horária mínima", que o avaliador reprova por design) e um componente
 * maior que o teto. Ambas viram alocação forçada, não travamento — a diferença
 * entre "a projeção errou uma matéria" e "o endpoint não responde".
 */
export function alocar(
  fila: ItemFila[],
  fixos: ReadonlyMap<string, string>,
  aprovados: ReadonlySet<string>,
  primeiroSemestre: string,
  teto: number,
): SemestreProjetado[] {
  const pendentes = fila.filter((item) => !fixos.has(item.codigo));
  const fixadas = fila.filter((item) => fixos.has(item.codigo));
  const concluidos = new Set(aprovados);
  const semestres: SemestreProjetado[] = [];

  let semestre = primeiroSemestre;
  while (pendentes.length > 0 || fixadas.length > 0) {
    const componentes: ComponenteProjetado[] = [];
    let capacidade = teto;

    // Posições fixas primeiro: o aluno já decidiu, e elas cobram o teto antes
    // de o projetor escolher qualquer coisa.
    for (let i = fixadas.length - 1; i >= 0; i -= 1) {
      if (fixos.get(fixadas[i].codigo) === semestre) {
        componentes.push(projetar(fixadas[i], { manual: true, naoVerificado: false }));
        capacidade -= fixadas[i].cargaHoraria;
        fixadas.splice(i, 1);
      }
    }

    for (let i = 0; i < pendentes.length; i += 1) {
      const item = pendentes[i];
      if (item.cargaHoraria > capacidade) {
        continue;
      }
      if (!avaliarPreRequisito(item.preRequisito, concluidos)) {
        continue;
      }
      componentes.push(projetar(item, { manual: false, naoVerificado: false }));
      capacidade -= item.cargaHoraria;
      pendentes.splice(i, 1);
      i -= 1;
    }

    // Válvula: o semestre não recebeu nada e ainda há fila. Sem isso, um
    // pré-requisito insatisfazível ou um componente maior que o teto giram
    // para sempre.
    if (componentes.length === 0 && pendentes.length > 0) {
      const item = pendentes.shift()!;
      componentes.push(
        projetar(item, {
          manual: false,
          naoVerificado: !avaliarPreRequisito(item.preRequisito, concluidos),
        }),
      );
    }

    for (const componente of componentes) {
      concluidos.add(componente.codigo);
    }
    semestres.push({ semestre, componentes, horasOptativas: 0, horasComplementares: 0 });
    semestre = proximoSemestre(semestre);
  }

  return semestres;
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/curriculo/projetor.spec.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/projetor.ts backend/src/curriculo/projetor.spec.ts
git commit -m "feat(curriculo): projetor guloso de semestres futuros"
```

---

### Task 5: Horas genéricas e composição da projeção

Derrama as horas de optativa/complementar no espaço que sobra, e compõe a resposta inteira — conclusão projetada, atraso, prazo máximo.

**Files:**
- Create: `backend/src/curriculo/projecao-trajetoria.ts`
- Test: `backend/src/curriculo/projecao-trajetoria.spec.ts`

**Interfaces:**
- Consumes: tudo das tasks 1–4, `EstruturaCurricularSalva`, `Historico`, `MarcosResponse`, `ItemPlano` de `../sigaa-engine/historico.repository`, `SITUACOES_INTEGRALIZADAS` de `../sigaa-engine/parsers/historico`.
- Produces:
  ```ts
  export interface ProjecaoResponse {
    semestres: SemestreProjetado[];
    teto: number;
    atrasadas: number;
    conclusaoProjetada: string;
    semestresAlemDoPrevisto: number;
    alemDoPrazoMaximo: boolean;
  }
  export function derramarHorasGenericas(
    semestres: SemestreProjetado[],
    horasOptativas: number,
    horasComplementares: number,
    teto: number,
    primeiroSemestre: string,
  ): SemestreProjetado[]
  export function montarProjecao(
    estrutura: EstruturaCurricularSalva,
    historico: Historico,
    marcos: MarcosResponse,
    overrides: ItemPlano[],
  ): ProjecaoResponse
  ```

- [ ] **Step 1: Escreva o teste que falha**

```ts
// backend/src/curriculo/projecao-trajetoria.spec.ts
import type { Historico } from '../sigaa-engine/parsers/historico';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import type { MarcosResponse } from './marcos-semestralizacao';
import { derramarHorasGenericas, montarProjecao } from './projecao-trajetoria';

const SEM_MARCOS: MarcosResponse = {
  marcos: [],
  ritmo: null,
  obsoletas: [],
  equivalencias: [],
};

function estrutura(
  componentes: EstruturaCurricularSalva['componentes'],
): EstruturaCurricularSalva {
  return {
    idSigaa: 'E1',
    codigo: 'G20251',
    anoPeriodoImplementacao: '2025.1',
    cargaHorariaTotal: 3000,
    cargaHorariaObrigatoria: 2400,
    cargaHorariaOptativaMinima: 360,
    cargaHorariaComplementarMinima: 240,
    prazoMinimoSemestres: 8,
    prazoMedioSemestres: 10,
    prazoMaximoSemestres: 14,
    fetchedAt: new Date('2026-08-01'),
    staleAfter: new Date('2026-09-01'),
    componentes,
  };
}

function componente(
  codigo: string,
  periodo: number | null,
  cargaHoraria = 60,
): EstruturaCurricularSalva['componentes'][number] {
  return {
    idSigaa: codigo,
    codigo,
    nome: codigo,
    cargaHoraria,
    natureza: periodo === null ? 'OPTATIVA' : 'OBRIGATORIA',
    periodo,
    unidadeResponsavel: null,
    preRequisito: null,
    coRequisito: null,
    equivalencias: null,
  };
}

function historico(parcial: Partial<Historico> = {}): Historico {
  return {
    emitidoEm: '2026-08-01',
    curriculo: 'G20251 - 2025.1',
    nomeCurso: 'CIÊNCIA DA COMPUTAÇÃO',
    periodoLetivoAtual: 3,
    prazoConclusaoPadrao: '2027.2',
    prazoConclusaoMaximo: '2029.2',
    indices: { cr: 8, iap: 8 },
    cursados: [
      {
        semestre: '2026.1',
        natureza: 'OB',
        codigo: 'A',
        nome: 'A',
        cargaHoraria: 120,
        nota: 8,
        situacao: 'APR',
        docente: null,
      },
    ],
    pendentesObrigatorios: [],
    cargaHoraria: {
      obrigatorias: { exigida: 2400, integralizada: 120, pendente: 2280 },
      optativas: { exigida: 360, integralizada: 0, pendente: 0 },
      complementares: { exigida: 240, integralizada: 0, pendente: 0 },
      total: { exigida: 3000, integralizada: 120, pendente: 2880 },
    },
    equivalencias: [],
    observacoes: [],
    ...parcial,
  };
}

describe('derramarHorasGenericas', () => {
  it('usa a folga do semestre antes de abrir um novo', () => {
    const semestres = [
      { semestre: '2026.2', componentes: [], horasOptativas: 0, horasComplementares: 0 },
    ];
    const [primeiro, segundo] = derramarHorasGenericas(semestres, 180, 0, 120, '2026.2');

    expect(primeiro.horasOptativas).toBe(120);
    expect(segundo).toMatchObject({ semestre: '2027.1', horasOptativas: 60 });
  });

  it('desconta o que as obrigatórias já ocupam', () => {
    const semestres = [
      {
        semestre: '2026.2',
        componentes: [
          {
            codigo: 'A',
            nome: 'A',
            cargaHoraria: 90,
            periodo: 1,
            atrasada: false,
            manual: false,
            preRequisitoNaoVerificado: false,
          },
        ],
        horasOptativas: 0,
        horasComplementares: 0,
      },
    ];
    const [primeiro] = derramarHorasGenericas(semestres, 120, 0, 120, '2026.2');

    expect(primeiro.horasOptativas).toBe(30);
  });

  it('abre semestres do zero quando só faltam horas genéricas', () => {
    const semestres = derramarHorasGenericas([], 0, 200, 120, '2026.2');

    expect(semestres.map((s) => s.horasComplementares)).toEqual([120, 80]);
    expect(semestres.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
  });

  it('não mexe em nada quando não falta hora genérica', () => {
    const semestres = [
      { semestre: '2026.2', componentes: [], horasOptativas: 0, horasComplementares: 0 },
    ];
    expect(derramarHorasGenericas(semestres, 0, 0, 120, '2026.2')).toEqual(semestres);
  });
});

describe('montarProjecao', () => {
  it('começa no semestre seguinte ao último do histórico', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 2)]),
      historico({ pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 60, matriculado: false }] }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.semestres[0].semestre).toBe('2026.2');
  });

  it('conta as atrasadas e projeta a conclusão no último semestre', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120), componente('C', 2, 120)]),
      historico({
        periodoLetivoAtual: 3,
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    // Teto = min(período mais pesado da grade (120), recorde do aluno (120)).
    expect(projecao.teto).toBe(120);
    expect(projecao.atrasadas).toBe(2);
    expect(projecao.conclusaoProjetada).toBe('2027.1');
  });

  it('mede o atraso contra o prazo padrão do histórico', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoPadrao: '2026.2',
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    // B em 2026.2, C (obsoleta pura) em 2027.1 — um semestre além do padrão.
    expect(projecao.conclusaoProjetada).toBe('2027.1');
    expect(projecao.semestresAlemDoPrevisto).toBe(1);
    expect(projecao.alemDoPrazoMaximo).toBe(false);
  });

  it('avisa quando a projeção passa do prazo máximo, sem cortar a fila', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoMaximo: '2026.2',
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.alemDoPrazoMaximo).toBe(true);
    // Nada foi cortado: as duas continuam alocadas.
    expect(projecao.semestres.flatMap((s) => s.componentes)).toHaveLength(2);
  });

  it('não conta como além do previsto quem termina antes do prazo', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        prazoConclusaoPadrao: '2029.1',
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [],
    );

    expect(projecao.semestresAlemDoPrevisto).toBe(0);
  });

  it('trata quem cursou o código antigo como tendo o pré-requisito novo', () => {
    const projecao = montarProjecao(
      estrutura([
        componente('NOVA2', 1, 120),
        { ...componente('C', 2, 120), preRequisito: '(NOVA2)' },
      ]),
      historico({
        cursados: [
          {
            semestre: '2026.1',
            natureza: 'OB',
            codigo: 'VELHA2',
            nome: 'VELHA2',
            cargaHoraria: 120,
            nota: 8,
            situacao: 'APR',
            docente: null,
          },
        ],
        pendentesObrigatorios: [{ codigo: 'C', nome: 'C', cargaHoraria: 120, matriculado: false }],
      }),
      { ...SEM_MARCOS, equivalencias: [{ codigo: 'VELHA2', equivalenteDe: 'NOVA2' }] },
      [],
    );

    // C libera de imediato: VELHA2 satisfaz o pré-requisito escrito como NOVA2.
    expect(projecao.semestres).toHaveLength(1);
    expect(projecao.semestres[0].componentes[0]).toMatchObject({
      codigo: 'C',
      preRequisitoNaoVerificado: false,
    });
  });

  it('respeita o override do aluno', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [{ codigo: 'B', nome: 'B', cargaHoraria: 120, semestre: '2027.2' }],
    );

    const alocado = projecao.semestres.find((s) =>
      s.componentes.some((c) => c.codigo === 'B'),
    );
    expect(alocado?.semestre).toBe('2027.2');
    expect(alocado?.componentes[0].manual).toBe(true);
  });

  it('ignora override sem semestre — é o pool, não uma posição', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1, 120)]),
      historico({
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 120, matriculado: false }],
      }),
      SEM_MARCOS,
      [{ codigo: 'B', nome: 'B', cargaHoraria: 120, semestre: null }],
    );

    expect(projecao.semestres[0].semestre).toBe('2026.2');
    expect(projecao.semestres[0].componentes[0].manual).toBe(false);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/curriculo/projecao-trajetoria.spec.ts`
Expected: FAIL — `Cannot find module './projecao-trajetoria'`

- [ ] **Step 3: Implemente**

```ts
// backend/src/curriculo/projecao-trajetoria.ts
import type { ItemPlano } from '../sigaa-engine/historico.repository';
import {
  SITUACOES_INTEGRALIZADAS,
  type Historico,
} from '../sigaa-engine/parsers/historico';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { montarFila } from './fila-de-pendentes';
import type { MarcosResponse } from './marcos-semestralizacao';
import { alocar, type SemestreProjetado } from './projetor';
import { compararSemestres, distanciaEmSemestres, proximoSemestre } from './semestre';
import { tetoDeCarga } from './teto-de-carga';

export interface ProjecaoResponse {
  semestres: SemestreProjetado[];
  teto: number;
  atrasadas: number;
  /** O último semestre da projeção — onde a linha de chegada aterrissa. */
  conclusaoProjetada: string;
  /** Distância até `prazoConclusaoPadrao`; zero quando termina no prazo ou antes. */
  semestresAlemDoPrevisto: number;
  alemDoPrazoMaximo: boolean;
}

/**
 * As horas de optativa e complementar que faltam, derramadas no espaço que
 * sobra do teto em cada semestre — optativas primeiro.
 *
 * Não são componentes e não têm id: o bloco que a tela desenha é resíduo de
 * renderização, não entidade. É isso que deixa a futura seleção de optativas
 * barata — ela vai operar sobre a exigência inteira, não sobre um bloco.
 */
export function derramarHorasGenericas(
  semestres: SemestreProjetado[],
  horasOptativas: number,
  horasComplementares: number,
  teto: number,
  primeiroSemestre: string,
): SemestreProjetado[] {
  if (horasOptativas <= 0 && horasComplementares <= 0) {
    return semestres;
  }

  const resultado = semestres.map((s) => ({ ...s }));
  let optativas = horasOptativas;
  let complementares = horasComplementares;
  let indice = 0;

  while (optativas > 0 || complementares > 0) {
    if (indice === resultado.length) {
      const semestre =
        indice === 0
          ? primeiroSemestre
          : proximoSemestre(resultado[indice - 1].semestre);
      resultado.push({ semestre, componentes: [], horasOptativas: 0, horasComplementares: 0 });
    }
    const atual = resultado[indice];
    const ocupado = atual.componentes.reduce((soma, c) => soma + c.cargaHoraria, 0);
    let folga = Math.max(0, teto - ocupado);

    const deOptativa = Math.min(folga, optativas);
    atual.horasOptativas += deOptativa;
    optativas -= deOptativa;
    folga -= deOptativa;

    const deComplementar = Math.min(folga, complementares);
    atual.horasComplementares += deComplementar;
    complementares -= deComplementar;

    // Um semestre já lotado de obrigatórias tem folga zero: sem esta guarda o
    // laço giraria nele para sempre.
    if (deOptativa === 0 && deComplementar === 0 && indice === resultado.length - 1) {
      resultado.push({
        semestre: proximoSemestre(atual.semestre),
        componentes: [],
        horasOptativas: 0,
        horasComplementares: 0,
      });
    }
    indice += 1;
  }

  return resultado;
}

/** O semestre em que a projeção começa: o seguinte ao último do histórico. */
function primeiroSemestreFuturo(historico: Historico): string {
  const semestres = historico.cursados.map((c) => c.semestre).sort(compararSemestres);
  const ultimo = semestres[semestres.length - 1];
  return ultimo ? proximoSemestre(ultimo) : historico.prazoConclusaoPadrao;
}

/**
 * Os códigos que satisfazem um pré-requisito: o que o aluno concluiu, mais —
 * para cada concluído que substitui um código antigo — o código substituído.
 * Quem cursou VELHA2 satisfaz um pré-requisito escrito como NOVA2.
 */
function codigosConcluidos(historico: Historico, marcos: MarcosResponse): Set<string> {
  const substitutoDe = new Map(marcos.equivalencias.map((e) => [e.codigo, e.equivalenteDe]));
  const concluidos = new Set<string>();
  for (const componente of historico.cursados) {
    if (!SITUACOES_INTEGRALIZADAS.includes(componente.situacao)) {
      continue;
    }
    concluidos.add(componente.codigo);
    const substituto = substitutoDe.get(componente.codigo);
    if (substituto) {
      concluidos.add(substituto);
    }
  }
  return concluidos;
}

/**
 * A projeção inteira, pronta para o controller serializar.
 *
 * O prazo máximo do histórico não vira corte: parar de alocar ali deixaria
 * matérias sem semestre nenhum e esconderia justamente o aluno que mais
 * precisa saber. A projeção segue até a fila esvaziar e devolve
 * `alemDoPrazoMaximo` — aviso, não bloqueio, porque o prazo tem prorrogação
 * por processo e o app não sabe se ela já aconteceu.
 */
export function montarProjecao(
  estrutura: EstruturaCurricularSalva,
  historico: Historico,
  marcos: MarcosResponse,
  overrides: ItemPlano[],
): ProjecaoResponse {
  const teto = tetoDeCarga(estrutura.componentes, historico.cursados);
  const fila = montarFila(
    historico.pendentesObrigatorios,
    estrutura.componentes,
    marcos.equivalencias,
    historico.periodoLetivoAtual,
  );
  const fixos = new Map(
    overrides.flatMap((item) => (item.semestre ? [[item.codigo, item.semestre] as const] : [])),
  );
  const primeiro = primeiroSemestreFuturo(historico);

  const alocados = alocar(fila, fixos, codigosConcluidos(historico, marcos), primeiro, teto);
  const semestres = derramarHorasGenericas(
    alocados,
    historico.cargaHoraria.optativas.pendente,
    historico.cargaHoraria.complementares.pendente,
    teto,
    primeiro,
  );

  const conclusaoProjetada = semestres[semestres.length - 1]?.semestre ?? primeiro;

  return {
    semestres,
    teto,
    atrasadas: fila.filter((item) => item.atrasada).length,
    conclusaoProjetada,
    semestresAlemDoPrevisto: Math.max(
      0,
      distanciaEmSemestres(historico.prazoConclusaoPadrao, conclusaoProjetada),
    ),
    alemDoPrazoMaximo:
      compararSemestres(conclusaoProjetada, historico.prazoConclusaoMaximo) > 0,
  };
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/curriculo/projecao-trajetoria.spec.ts`
Expected: PASS (13 testes)

- [ ] **Step 5: Rode a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: tudo verde — nenhum módulo existente foi tocado até aqui.

- [ ] **Step 6: Commit**

```bash
git add backend/src/curriculo/projecao-trajetoria.ts backend/src/curriculo/projecao-trajetoria.spec.ts
git commit -m "feat(curriculo): composição da projeção com horas genéricas e prazos"
```

---

### Task 6: Expor a projeção no `GET /trajetoria`

**Files:**
- Modify: `backend/src/sigaa-engine/trajetoria.controller.ts`
- Test: `backend/src/sigaa-engine/trajetoria.controller.spec.ts`

**Interfaces:**
- Consumes: `montarProjecao`, `ProjecaoResponse` (Task 5).
- Produces: `TrajetoriaResponse` ganha `projecao: ProjecaoResponse | null`.

- [ ] **Step 1: Escreva o teste que falha**

Abra `backend/src/sigaa-engine/trajetoria.controller.spec.ts`, veja como os testes existentes montam o mock de `CurriculoService` e `HistoricoService`, e acrescente — reaproveitando os helpers de fixture que já estiverem no arquivo:

```ts
it('devolve a projeção junto dos marcos', async () => {
  // Use o mesmo mock de curriculoService.resolverPorNomeUsuario que os testes
  // de marcos já usam neste arquivo, com uma estrutura que tenha ao menos um
  // componente com `periodo`, e um histórico com uma pendente desse código.
  const resposta = await controller.get({ userId: 'user-1' } as RequestUser);

  expect(resposta).toMatchObject({ projecao: expect.any(Object) });
  if (!('projecao' in resposta) || resposta.projecao === null) {
    throw new Error('esperava projeção');
  }
  expect(resposta.projecao.semestres.length).toBeGreaterThan(0);
});

it('degrada para projecao null quando a estrutura não resolve, sem derrubar o resto', async () => {
  jest
    .mocked(curriculoService.resolverPorNomeUsuario)
    .mockRejectedValueOnce(new Error('curso não encontrado'));

  const resposta = await controller.get({ userId: 'user-1' } as RequestUser);

  expect(resposta).toMatchObject({ marcos: null, projecao: null });
  // O histórico continua lá: a projeção é extra, nunca motivo de falha.
  expect('historico' in resposta && resposta.historico).toBeTruthy();
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/sigaa-engine/trajetoria.controller.spec.ts`
Expected: FAIL — `projecao` não existe na resposta.

- [ ] **Step 3: Implemente**

Em `trajetoria.controller.ts`: acrescente o import, o campo no tipo, e troque `resolverMarcos` por um método que resolve a estrutura **uma vez** e deriva os dois — hoje são a mesma chamada, e resolver duas vezes seria um request a mais por leitura de tela.

```ts
import {
  montarMarcosResponse,
  type MarcosResponse,
} from '../curriculo/marcos-semestralizacao';
import {
  montarProjecao,
  type ProjecaoResponse,
} from '../curriculo/projecao-trajetoria';
```

No tipo `TrajetoriaResponse`, junto de `marcos`:

```ts
      /**
       * Null pelos mesmos motivos que `marcos`: sem estrutura curricular
       * resolvida não há período de onde inferir nada. A tela cai na linha do
       * tempo só-passado.
       */
      projecao: ProjecaoResponse | null;
```

E no corpo da classe, substituindo `resolverMarcos`:

```ts
  private async serializar(
    salva: TrajetoriaSalva,
  ): Promise<TrajetoriaResponse> {
    const { marcos, projecao } = await this.resolverCurriculo(salva);
    return {
      historico: salva.historico,
      fetchedAt: salva.fetchedAt.toISOString(),
      plano: salva.plano,
      marcos,
      projecao,
    };
  }

  /**
   * Marcos e projeção saem da mesma estrutura curricular, então são resolvidos
   * juntos: separá-los custaria um segundo `resolverPorNomeUsuario` por leitura
   * de tela. Falha em qualquer um dos dois derruba os dois — ambos são extras
   * best-effort, e uma tela com marcos mas sem projeção não é um estado que
   * valha a pena existir.
   */
  private async resolverCurriculo(salva: TrajetoriaSalva): Promise<{
    marcos: MarcosResponse | null;
    projecao: ProjecaoResponse | null;
  }> {
    try {
      const estrutura = await this.curriculoService.resolverPorNomeUsuario(
        salva.historico.nomeCurso,
      );
      const marcos = montarMarcosResponse(estrutura, salva.historico);
      return {
        marcos,
        projecao: montarProjecao(estrutura, salva.historico, marcos, salva.plano),
      };
    } catch (erro) {
      this.logger.warn(
        `Não foi possível resolver a estrutura curricular do aluno: ${erro}`,
      );
      return { marcos: null, projecao: null };
    }
  }
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/sigaa-engine/trajetoria.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/sigaa-engine/trajetoria.controller.ts backend/src/sigaa-engine/trajetoria.controller.spec.ts
git commit -m "feat(trajetoria): expor a projeção no GET /trajetoria"
```

---

### Task 7: Persistir os ajustes manuais

`PlanoItem` já existe no schema e já é podado quando a matéria é concluída; falta só o caminho de escrita.

**Files:**
- Modify: `backend/src/sigaa-engine/historico.repository.ts` (interface)
- Modify: `backend/src/db/prisma-historico.repository.ts`
- Modify: `backend/src/sigaa-engine/trajetoria.controller.ts`
- Create: `backend/src/sigaa-engine/plano.dto.ts`
- Test: `backend/src/db/prisma-historico.repository.spec.ts`, `backend/src/sigaa-engine/trajetoria.controller.spec.ts`

**Interfaces:**
- Produces: `HistoricoRepository.salvarPlano(userId: string, itens: ItemPlano[]): Promise<void>`; `PUT /trajetoria/plano` recebendo `{ itens: { codigo, nome, cargaHoraria, semestre }[] }` e devolvendo o `TrajetoriaResponse` atualizado.

- [ ] **Step 1: Escreva o teste do repositório**

```ts
// em backend/src/db/prisma-historico.repository.spec.ts
it('salvarPlano faz upsert por (userId, codigo)', async () => {
  const upsert = jest.fn();
  const prisma = { planoItem: { upsert } } as unknown as PrismaService;
  const repo = new PrismaHistoricoRepository(prisma);

  await repo.salvarPlano('user-1', [
    { codigo: 'MATA55', nome: 'SISTEMAS OPERACIONAIS', cargaHoraria: 68, semestre: '2027.1' },
  ]);

  expect(upsert).toHaveBeenCalledWith({
    where: { userId_codigo: { userId: 'user-1', codigo: 'MATA55' } },
    create: {
      userId: 'user-1',
      codigo: 'MATA55',
      nome: 'SISTEMAS OPERACIONAIS',
      cargaHoraria: 68,
      semestre: '2027.1',
    },
    update: { semestre: '2027.1' },
  });
});

it('salvarPlano apaga o item cujo semestre voltou a ser nulo', async () => {
  const deleteMany = jest.fn();
  const prisma = {
    planoItem: { upsert: jest.fn(), deleteMany },
  } as unknown as PrismaService;
  const repo = new PrismaHistoricoRepository(prisma);

  await repo.salvarPlano('user-1', [
    { codigo: 'MATA55', nome: 'SO', cargaHoraria: 68, semestre: null },
  ]);

  // Sem semestre não é uma posição — é a ausência dela. Guardar a linha só
  // deixaria um override fantasma que o projetor ignora de qualquer jeito.
  expect(deleteMany).toHaveBeenCalledWith({
    where: { userId: 'user-1', codigo: { in: ['MATA55'] } },
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd backend && npm test -- src/db/prisma-historico.repository.spec.ts`
Expected: FAIL — `repo.salvarPlano is not a function`

- [ ] **Step 3: Implemente o repositório**

Em `historico.repository.ts`, na interface:

```ts
  /**
   * Grava as posições que o aluno escolheu à mão. Upsert por código, não
   * replace da tabela inteira: a tela manda só o que mudou, e um replace
   * apagaria as decisões que ela não estava exibindo.
   *
   * `semestre: null` apaga a linha — a ausência de posição não é uma posição,
   * e guardá-la deixaria um override que o projetor ignora.
   */
  salvarPlano(userId: string, itens: ItemPlano[]): Promise<void>;
```

Em `prisma-historico.repository.ts`:

```ts
  async salvarPlano(userId: string, itens: ItemPlano[]): Promise<void> {
    const removidos = itens.filter((item) => item.semestre === null);
    if (removidos.length > 0) {
      await this.prisma.planoItem.deleteMany({
        where: { userId, codigo: { in: removidos.map((item) => item.codigo) } },
      });
    }
    for (const item of itens.filter((i) => i.semestre !== null)) {
      await this.prisma.planoItem.upsert({
        where: { userId_codigo: { userId, codigo: item.codigo } },
        create: {
          userId,
          codigo: item.codigo,
          nome: item.nome,
          cargaHoraria: item.cargaHoraria,
          semestre: item.semestre,
        },
        update: { semestre: item.semestre },
      });
    }
  }
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd backend && npm test -- src/db/prisma-historico.repository.spec.ts`
Expected: PASS

- [ ] **Step 5: Escreva o teste do endpoint**

```ts
// em backend/src/sigaa-engine/trajetoria.controller.spec.ts
it('PUT /trajetoria/plano grava e devolve a trajetória reprojetada', async () => {
  const itens = [
    { codigo: 'MATA55', nome: 'SO', cargaHoraria: 68, semestre: '2027.1' },
  ];

  const resposta = await controller.salvarPlano({ userId: 'user-1' } as RequestUser, { itens });

  expect(historicoService.salvarPlano).toHaveBeenCalledWith('user-1', itens);
  expect('historico' in resposta).toBe(true);
});
```

- [ ] **Step 6: Implemente o DTO e o endpoint**

```ts
// backend/src/sigaa-engine/plano.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class ItemPlanoDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsInt()
  cargaHoraria!: number;

  // "AAAA.N", ou null para tirar a matéria da posição escolhida. O formato é
  // validado aqui porque o projetor faz aritmética em cima dele.
  @IsOptional()
  @Matches(/^\d{4}\.[12]$/)
  semestre!: string | null;
}

export class SalvarPlanoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemPlanoDto)
  itens!: ItemPlanoDto[];
}
```

Em `trajetoria.controller.ts`:

```ts
  @Put('trajetoria/plano')
  async salvarPlano(
    @CurrentUser() user: RequestUser,
    @Body() dto: SalvarPlanoDto,
  ): Promise<TrajetoriaResponse> {
    await this.historicoService.salvarPlano(user.userId, dto.itens);
    return this.get(user);
  }
```

Acrescente `Put` ao import de `@nestjs/common` e o repasse em `HistoricoService`:

```ts
  /** Repasse direto: posicionar matéria não toca no SIGAA nem no histórico. */
  async salvarPlano(userId: string, itens: ItemPlano[]): Promise<void> {
    await this.historicoRepository.salvarPlano(userId, itens);
  }
```

- [ ] **Step 7: Rode a suíte do backend**

Run: `cd backend && npm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add backend/src/sigaa-engine backend/src/db/prisma-historico.repository.ts
git commit -m "feat(trajetoria): persistir os ajustes manuais do planejador"
```

---

### Task 8: Tipos e cliente no mobile

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Test: `mobile/src/__tests__/api.test.ts`

**Interfaces:**
- Produces: `ProjecaoTrajetoria`, `SemestreProjetado`, `ComponenteProjetado` em `types.ts`; `putPlano(accessToken, itens)` em `api.ts`.

- [ ] **Step 1: Escreva o teste que falha**

```ts
// em mobile/src/__tests__/api.test.ts, seguindo o padrão dos testes vizinhos
it("putPlano manda os itens para /trajetoria/plano", async () => {
  mockFetchOnce({ sincronizado: false });

  await putPlano("token", [{ codigo: "MATA55", nome: "SO", cargaHoraria: 68, semestre: "2027.1" }]);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/trajetoria/plano"),
    expect.objectContaining({ method: "PUT" }),
  );
});
```

Use o helper de mock de `fetch` que o arquivo já tiver; não invente um novo.

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd mobile && npx jest src/__tests__/api.test.ts`
Expected: FAIL — `putPlano is not exported`

- [ ] **Step 3: Implemente**

Em `types.ts`, espelhando o backend:

```ts
/** Espelha ComponenteProjetado do backend — ver curriculo/projetor.ts. */
export interface ComponenteProjetado {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null na obsoleta pura: nenhum componente ativo com esse código. */
  periodo: number | null;
  atrasada: boolean;
  /** O aluno pôs aqui; o projetor não escolheu. */
  manual: boolean;
  preRequisitoNaoVerificado: boolean;
}

export interface SemestreProjetado {
  semestre: string;
  componentes: ComponenteProjetado[];
  horasOptativas: number;
  horasComplementares: number;
}

/** Espelha ProjecaoResponse — ver curriculo/projecao-trajetoria.ts. */
export interface ProjecaoTrajetoria {
  semestres: SemestreProjetado[];
  teto: number;
  atrasadas: number;
  conclusaoProjetada: string;
  semestresAlemDoPrevisto: number;
  alemDoPrazoMaximo: boolean;
}
```

E no membro `TrajetoriaResponse`, junto de `marcos`:

```ts
      /** Null quando a estrutura curricular não resolve — extra best-effort. */
      projecao: ProjecaoTrajetoria | null;
```

Em `api.ts`:

```ts
/** Grava as posições que o aluno escolheu e devolve a trajetória reprojetada. */
export async function putPlano(
  accessToken: string,
  itens: ItemPlano[],
): Promise<TrajetoriaResponse> {
  return request<TrajetoriaResponse>("/trajetoria/plano", {
    method: "PUT",
    accessToken,
    body: { itens },
  });
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd mobile && npx jest src/__tests__/api.test.ts && npx tsc --noEmit`
Expected: teste PASS. O `tsc` vai acusar `projecao` faltando nas fixtures dos testes de tela — é esperado e a Task 9 resolve.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/__tests__/api.test.ts
git commit -m "feat(mobile): tipos da projeção e cliente de PUT /trajetoria/plano"
```

---

### Task 9: Linha do tempo com os semestres futuros

Onde o balde "Sem período" morre.

**Files:**
- Modify: `mobile/src/screens/TrajetoriaTab.tsx`
- Modify: `mobile/src/lib/trajetoria.ts`
- Test: `mobile/src/__tests__/trajetoria.test.tsx`, `mobile/src/lib/trajetoria.test.ts`

**Interfaces:**
- Consumes: `ProjecaoTrajetoria` (Task 8), `AnoTrajetoria`/`agruparPorAno` já existentes.
- Produces: `anosDaProjecao(periodos: PeriodoTrajetoria[], projecao: ProjecaoTrajetoria | null): AnoTrajetoria[]` em `trajetoria.ts` — a lista única de anos que a `LinhaDoTempo` desenha, passado e futuro juntos.

- [ ] **Step 1: Escreva o teste da função pura**

```ts
// em mobile/src/lib/trajetoria.test.ts
describe("anosDaProjecao", () => {
  it("emenda os semestres futuros depois dos cursados, no mesmo eixo de anos", () => {
    const periodos = [
      { semestre: "2026.1", componentes: [], emCurso: true },
    ];
    const projecao = {
      semestres: [
        { semestre: "2026.2", componentes: [], horasOptativas: 0, horasComplementares: 0 },
        { semestre: "2027.1", componentes: [], horasOptativas: 0, horasComplementares: 0 },
      ],
      teto: 300,
      atrasadas: 0,
      conclusaoProjetada: "2027.1",
      semestresAlemDoPrevisto: 0,
      alemDoPrazoMaximo: false,
    };

    const anos = anosDaProjecao(periodos, projecao);

    expect(anos.map((a) => a.ano)).toEqual(["2026", "2027"]);
    // 2026 junta o cursado e o projetado no mesmo ano.
    expect(anos[0].periodos.map((p) => p.semestre)).toEqual(["2026.1", "2026.2"]);
  });

  it("devolve só o passado quando não há projeção", () => {
    const periodos = [{ semestre: "2026.1", componentes: [], emCurso: true }];
    expect(anosDaProjecao(periodos, null).map((a) => a.ano)).toEqual(["2026"]);
  });
});
```

Confira a forma exata de `PeriodoTrajetoria` em `mobile/src/lib/trajetoria.ts:11` e ajuste a fixture se ela tiver mais campos.

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd mobile && npx jest src/lib/trajetoria.test.ts`
Expected: FAIL — `anosDaProjecao is not a function`

- [ ] **Step 3: Implemente a função pura**

Em `mobile/src/lib/trajetoria.ts`, junto de `agruparPorAno`:

Acrescente ao import de `./types`, no topo do arquivo, os tipos
`ProjecaoTrajetoria` e `SemestreProjetado` (criados na Task 8).

`AnoTrajetoria` **já existe** em `mobile/src/lib/trajetoria.ts:174` com
`{ ano, periodos }` — acrescente o terceiro campo à interface existente em vez
de declarar outra:

```ts
export interface AnoTrajetoria {
  ano: string;
  periodos: PeriodoTrajetoria[];
  /** Os semestres que ainda não aconteceram, no mesmo ano. */
  projetados: SemestreProjetado[];
}

/**
 * Passado e futuro no mesmo eixo de anos. Um ano pode ter os dois — o ano
 * corrente costuma ter o semestre em curso e o seguinte já projetado — então
 * agrupar os dois separadamente e concatenar produziria "2026" duas vezes.
 */
export function anosDaProjecao(
  periodos: PeriodoTrajetoria[],
  projecao: ProjecaoTrajetoria | null,
): AnoTrajetoria[] {
  const anos = new Map<string, AnoTrajetoria>();
  const doAno = (semestre: string): AnoTrajetoria => {
    const ano = semestre.slice(0, 4);
    const existente = anos.get(ano);
    if (existente) {
      return existente;
    }
    const criado: AnoTrajetoria = { ano, periodos: [], projetados: [] };
    anos.set(ano, criado);
    return criado;
  };

  for (const periodo of periodos) {
    doAno(periodo.semestre).periodos.push(periodo);
  }
  for (const semestre of projecao?.semestres ?? []) {
    doAno(semestre.semestre).projetados.push(semestre);
  }
  return [...anos.values()];
}
```

`agruparPorAno` fica sem chamador depois disso — remova a função e os testes dela junto, na Task 11.

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd mobile && npx jest src/lib/trajetoria.test.ts`
Expected: PASS

- [ ] **Step 5: Escreva os testes de tela**

Em `mobile/src/__tests__/trajetoria.test.tsx`, acrescente `projecao: null` ao helper `trajetoria()` (linha ~144) para o `tsc` voltar a fechar, e um segundo helper que monta uma projeção. Depois:

```ts
it("desenha os semestres projetados depois dos cursados", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue({
    ...trajetoria({ cursados: [MATRICULADO] }),
    projecao: {
      semestres: [
        {
          semestre: "2026.2",
          componentes: [
            {
              codigo: "MATA60",
              nome: "BANCO DE DADOS",
              cargaHoraria: 68,
              periodo: 4,
              atrasada: false,
              manual: false,
              preRequisitoNaoVerificado: false,
            },
          ],
          horasOptativas: 0,
          horasComplementares: 0,
        },
      ],
      teto: 300,
      atrasadas: 0,
      conclusaoProjetada: "2026.2",
      semestresAlemDoPrevisto: 0,
      alemDoPrazoMaximo: false,
    },
  } as TrajetoriaResponse);

  await render(<TrajetoriaTab />);

  expect(await screen.findByText("MATA60")).toBeTruthy();
  // O balde morreu: nada mais fora da linha do tempo.
  expect(screen.queryByText("Sem período")).toBeNull();
  expect(screen.queryByText(/Ainda não salva/i)).toBeNull();
});

it("marca a atrasada com o período de origem dela", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(
    comProjecao([
      {
        semestre: "2026.2",
        componentes: [
          {
            codigo: "MATA60",
            nome: "BANCO DE DADOS",
            cargaHoraria: 68,
            periodo: 3,
            atrasada: true,
            manual: false,
            preRequisitoNaoVerificado: false,
          },
        ],
        horasOptativas: 0,
        horasComplementares: 0,
      },
    ]),
  );

  await render(<TrajetoriaTab />);

  // O selo viaja junto do card: espalhar o atraso não pode escondê-lo.
  expect(await screen.findByText("atrasada · 3º período")).toBeTruthy();
});

it("resume o atraso acima da linha do tempo", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(
    comProjecao([], {
      atrasadas: 5,
      conclusaoProjetada: "2028.2",
      semestresAlemDoPrevisto: 2,
    }),
  );

  await render(<TrajetoriaTab />);

  expect(await screen.findByText(/5 obrigatórias atrasadas/)).toBeTruthy();
  expect(screen.getByText(/2028\.2/)).toBeTruthy();
  expect(screen.getByText(/2 semestres além do previsto/)).toBeTruthy();
});

it("mostra as horas genéricas como bloco, não como card", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(
    comProjecao([
      {
        semestre: "2026.2",
        componentes: [],
        horasOptativas: 120,
        horasComplementares: 60,
      },
    ]),
  );

  await render(<TrajetoriaTab />);

  expect(await screen.findByText("120 h de optativas")).toBeTruthy();
  // Complementar é estágio/monitoria: nunca vai ser escolhível numa lista, e
  // chamá-la de optativa prometeria uma tela de escolha que não vai existir.
  expect(screen.getByText("60 h de atividades complementares")).toBeTruthy();
  // Não é matéria, então não é card.
  expect(screen.queryByTestId(/^materia-card-/)).toBeNull();
});

it("avisa quando a projeção passa do prazo máximo", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(
    comProjecao([], { alemDoPrazoMaximo: true, conclusaoProjetada: "2031.1" }),
  );

  await render(<TrajetoriaTab />);

  expect(await screen.findByText(/prazo máximo/i)).toBeTruthy();
});
```

O helper `comProjecao` monta a resposta inteira a partir dos semestres, para os
quatro testes não repetirem a fixture:

```tsx
function comProjecao(
  semestres: SemestreProjetado[],
  extras: Partial<ProjecaoTrajetoria> = {},
): TrajetoriaResponse {
  return {
    ...trajetoria({ cursados: [MATRICULADO] }),
    projecao: {
      semestres,
      teto: 300,
      atrasadas: 0,
      conclusaoProjetada: semestres[semestres.length - 1]?.semestre ?? "2026.2",
      semestresAlemDoPrevisto: 0,
      alemDoPrazoMaximo: false,
      ...extras,
    },
  } as TrajetoriaResponse;
}
```

- [ ] **Step 6: Implemente a tela**

Em `TrajetoriaTab.tsx`:

1. Remova `ZONA_SEM_PERIODO`, `ZONAS_FUTURAS`, o tipo `Plano`, `planoSalvo`, o estado `movimentos`, o `<View className="gap-5">` inteiro do planejador e o aviso "Ainda não salva".
2. `ReadyTrajetoria` passa a chamar `anosDaProjecao(periodos, projecao)` no lugar de `agruparPorAno(periodos)`.
3. Acima da `LinhaDoTempo`, quando `projecao.atrasadas > 0`, renderize o resumo:
   ```tsx
   <Typography.Paragraph type="body-sm" color="muted">
     {`${projecao.atrasadas} ${projecao.atrasadas === 1 ? "obrigatória atrasada" : "obrigatórias atrasadas"} · neste ritmo você conclui em ${projecao.conclusaoProjetada}${
       projecao.semestresAlemDoPrevisto > 0
         ? `, ${projecao.semestresAlemDoPrevisto} ${projecao.semestresAlemDoPrevisto === 1 ? "semestre" : "semestres"} além do previsto`
         : ""
     }.`}
   </Typography.Paragraph>
   ```
   E, quando `projecao.alemDoPrazoMaximo`, uma segunda linha dizendo que a projeção passa do prazo máximo de conclusão do histórico.
4. Em `LinhaDoTempo`, depois do `.map` dos `periodos` de cada ano, mapeie `anoBloco.projetados` renderizando um `<CardProjetado>` por componente e, quando `horasOptativas > 0` ou `horasComplementares > 0`, um bloco de horas genéricas. Reaproveite o cabeçalho de semestre existente, trocando o badge de situação por um rótulo "projetado".
5. `CardProjetado` é o `MateriaCard` sem nota e sem medidor de densidade, com o selo de atrasada no lugar da faixa de situação:
   ```tsx
   {componente.atrasada && componente.periodo !== null ? (
     <View className="rounded-t-2xl rounded-b-md px-3 py-1.5 bg-warning-soft">
       <Typography.Paragraph type="body-xs" className="text-warning">
         {`atrasada · ${componente.periodo}º período`}
       </Typography.Paragraph>
     </View>
   ) : null}
   ```
   Mantenha o `onPress` abrindo a árvore de dependências, igual ao card cursado.
6. O bloco de horas genéricas é um `View` tracejado, deliberadamente diferente de um card — ele não é matéria:
   ```tsx
   <View className="rounded-2xl border border-dashed border-white/20 p-3 gap-0.5">
     <Typography.Paragraph type="body-sm" color="muted">
       {`${horas} h de ${rotulo}`}
     </Typography.Paragraph>
   </View>
   ```
   com `rotulo` sendo `"optativas"` ou `"atividades complementares"` — nunca "optativas" para as duas: complementar é estágio/monitoria, nunca vai ser escolhível numa lista.

- [ ] **Step 7: Rode os testes**

Run: `cd mobile && npx jest src/__tests__/trajetoria.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add mobile/src/screens/TrajetoriaTab.tsx mobile/src/lib/trajetoria.ts mobile/src/lib/trajetoria.test.ts mobile/src/__tests__/trajetoria.test.tsx
git commit -m "feat(mobile): linha do tempo estendida pelos semestres projetados"
```

---

### Task 10: Mover matéria salvando de verdade

**Files:**
- Modify: `mobile/src/screens/TrajetoriaTab.tsx`
- Test: `mobile/src/__tests__/trajetoria.test.tsx`

**Interfaces:**
- Consumes: `putPlano` (Task 8), `ProjecaoTrajetoria` (Task 8).

- [ ] **Step 1: Escreva o teste que falha**

```tsx
const BANCO_PROJETADO = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  periodo: 4,
  atrasada: false,
  manual: false,
  preRequisitoNaoVerificado: false,
};

/** MATA60 em `semestre`, e sempre dois semestres para haver destino de menu. */
function comBancoEm(semestre: "2026.2" | "2027.1"): TrajetoriaResponse {
  return comProjecao([
    {
      semestre: "2026.2",
      componentes: semestre === "2026.2" ? [BANCO_PROJETADO] : [],
      horasOptativas: 0,
      horasComplementares: 0,
    },
    {
      semestre: "2027.1",
      componentes: semestre === "2027.1" ? [{ ...BANCO_PROJETADO, manual: true }] : [],
      horasOptativas: 0,
      horasComplementares: 0,
    },
  ]);
}

it("mover uma matéria salva a posição e aplica a trajetória que volta", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));
  jest.mocked(putPlano).mockResolvedValue(comBancoEm("2027.1"));

  await render(<TrajetoriaTab />);
  await screen.findByText("MATA60");

  // O cabeçalho do semestre e a opção do menu compartilham o texto; a opção é
  // a última das duas, dentro do card da própria matéria.
  const opcoes = screen.getAllByText("2027.1");
  await act(async () => {
    fireEvent.press(opcoes[opcoes.length - 1]);
  });

  expect(jest.mocked(putPlano)).toHaveBeenCalledWith("token", [
    { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 68, semestre: "2027.1" },
  ]);
});

it("mostra o erro quando o salvamento falha", async () => {
  jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));
  jest.mocked(putPlano).mockRejectedValue(new ApiError("Unauthorized", 401));
  const consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

  await render(<TrajetoriaTab />);
  await screen.findByText("MATA60");

  const opcoes = screen.getAllByText("2027.1");
  await act(async () => {
    fireEvent.press(opcoes[opcoes.length - 1]);
  });

  expect(await screen.findByText("Credenciais inválidas")).toBeTruthy();
  consoleWarn.mockRestore();
});
```

`comProjecao` é o helper criado na Task 9; reaproveite, não duplique.

Acrescente `putPlano: jest.fn()` ao `jest.mock("@/lib/api", ...)` no topo do arquivo.

- [ ] **Step 2: Rode e confirme a falha**

Run: `cd mobile && npx jest src/__tests__/trajetoria.test.tsx`
Expected: FAIL — `putPlano` nunca é chamado.

- [ ] **Step 3: Implemente**

Em `TrajetoriaTab.tsx`, `moverComponente` deixa de mexer em estado local e passa a salvar:

```tsx
  /**
   * Mover é override puro: grava a posição e aplica a trajetória reprojetada
   * que o servidor devolve. Deliberadamente sem otimismo local — a resposta
   * pode reordenar outros semestres por causa de pré-requisito, e uma tela
   * que se corrige sozinha meio segundo depois é pior que uma que espera.
   */
  const moverComponente = useCallback(
    async (componente: ComponenteProjetado, semestre: string) => {
      if (!accessToken) {
        return;
      }
      try {
        aplicar(
          await putPlano(accessToken, [
            {
              codigo: componente.codigo,
              nome: componente.nome,
              cargaHoraria: componente.cargaHoraria,
              semestre,
            },
          ]),
        );
      } catch (error) {
        console.warn("Failed to save plano", error);
        setState({ status: "error", message: describeApiError(error) });
      }
    },
    [accessToken, aplicar],
  );
```

O menu "Mover para" passa a listar `projecao.semestres.map((s) => s.semestre)`, menos o semestre atual do componente.

- [ ] **Step 4: Rode os testes**

Run: `cd mobile && npx jest src/__tests__/trajetoria.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/TrajetoriaTab.tsx mobile/src/__tests__/trajetoria.test.tsx
git commit -m "feat(mobile): persistir o reposicionamento de matéria na trajetória"
```

---

### Task 11: Remover o que ficou sem chamador

Código morto que passa no lint é o mais caro: o próximo leitor supõe que ainda é usado.

**Files:**
- Modify: `mobile/src/lib/trajetoria.ts`
- Modify: `mobile/src/lib/trajetoria.test.ts`

- [ ] **Step 1: Confirme que estão órfãs**

```bash
cd mobile && grep -rn "zonasDePlanejamento\|poolPlanejavel\|agruparPorAno" src --include="*.ts" --include="*.tsx"
```
Expected: só as definições em `src/lib/trajetoria.ts` e os testes delas.

- [ ] **Step 2: Remova**

Apague `zonasDePlanejamento`, `poolPlanejavel` e `agruparPorAno` de `mobile/src/lib/trajetoria.ts`, junto dos `describe` correspondentes em `mobile/src/lib/trajetoria.test.ts`. Mantenha `contarFaltantes` e `CODIGO_ENADE` — `contarFaltantes` é usada em outra tela; confirme com um grep antes.

- [ ] **Step 3: Rode tudo**

```bash
cd mobile && npx jest && npx tsc --noEmit && npx eslint src
```
Expected: testes verdes, sem erro de tipo novo, lint limpo.

Nota: `mobile/src/__tests__/ajustes.test.tsx:83` já tinha um erro `TS2347` **antes** desta entrega. Ele não é seu — não conserte aqui, e não deixe ele te convencer de que quebrou algo.

- [ ] **Step 4: Rode a suíte do backend uma última vez**

```bash
cd backend && npm test && npx eslint "src/**/*.ts"
```

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/trajetoria.ts mobile/src/lib/trajetoria.test.ts
git commit -m "refactor(mobile): remover o planejador de zonas fixas"
```
