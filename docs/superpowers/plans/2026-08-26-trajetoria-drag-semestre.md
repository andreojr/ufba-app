# Grid de arrastar semestres na Trajetória — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o menu de calendário do `CardProjetado` na Trajetória por um gesto de segurar-e-arrastar até um grid de semestres futuros, e garantir no backend que a projeção nunca mostra um semestre futuro vazio no meio da linha do tempo.

**Architecture:** Backend ganha um pós-processamento puro (`compactarSemestres`) chamado dentro de `montarProjecao`, sem mudar o algoritmo de alocação em si. Mobile ganha um `React.Context` (`ArrastoSemestreProvider`) que coordena um `Gesture.Pan` no `CardProjetado` (long-press ativa o arrasto) com um `Modal` full-screen (`SemestreDragGrid`) que não é filho do card — os dois se falam pelo contexto, não por props, porque vivem em pontos diferentes da árvore. A colisão do soltar contra os quadradinhos é geometria pura calculada em JS (grid de posições fixas), não `measureInWindow`, para o hit-test ser determinístico e testável.

**Tech Stack:** NestJS + Jest (backend); Expo Router + React Native + `react-native-gesture-handler` + `react-native-reanimated` + `heroui-native` (mobile), Jest + `@testing-library/react-native`.

**Spec:** [docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md](../specs/2026-08-26-trajetoria-drag-semestre-design.md)

## Global Constraints

- Sem otimismo local: toda chamada de `onMover`/`onSoltar` dispara `putPlano` e substitui o state inteiro pela resposta, exatamente como hoje (ver `moverComponente` em `TrajetoriaTab.tsx`).
- Nomes em português, seguindo a convenção do arquivo (`moverComponente`, `alternarAno`, etc.).
- Nenhuma mudança de formato em `ItemPlano`/`SalvarPlanoDto` — o backend continua recebendo `{ codigo, nome, cargaHoraria, semestre }`.
- `compactarSemestres` roda **sempre** dentro de `montarProjecao`, depois de `alocar` e antes de `derramarHorasGenericas`.
- Testes backend: Jest (`npm test` em `backend/`). Testes mobile: Jest + RTL (`npm test` em `mobile/`).

---

## Task 1: Backend — `compactarSemestres`

**Files:**
- Modify: `backend/src/curriculo/projetor.ts`
- Test: `backend/src/curriculo/projetor.spec.ts`

**Interfaces:**
- Consumes: `SemestreProjetado` (já existe em `projetor.ts`), `proximoSemestre` de `./semestre`.
- Produces: `export function compactarSemestres(semestres: SemestreProjetado[], primeiroSemestre: string): SemestreProjetado[]` — usado por `montarProjecao` na Task 2.

- [ ] **Step 1: Ler o arquivo de teste existente para seguir o padrão de mocks**

`backend/src/curriculo/projetor.spec.ts` já existe — abra e confira os helpers de `ItemFila`/`SemestreProjetado` usados nos testes de `alocar`, para reaproveitar o mesmo estilo de fixture nos novos testes.

- [ ] **Step 2: Escrever os testes que falham**

Adicione ao final de `backend/src/curriculo/projetor.spec.ts`:

```ts
import { alocar, compactarSemestres, type SemestreProjetado } from './projetor';

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
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest projetor.spec.ts -t compactarSemestres`
Expected: FAIL — `compactarSemestres` não existe (`TypeError: (0 , _projetor.compactarSemestres) is not a function`).

- [ ] **Step 4: Implementar `compactarSemestres`**

Em `backend/src/curriculo/projetor.ts`, adicione a função (após `alocar`, antes do fechamento do arquivo):

```ts
/**
 * Remove semestres sem nenhum componente e renumera os que sobraram,
 * fechando o buraco — nunca é exibido um semestre futuro vazio no meio da
 * linha do tempo. `alocar` já pode produzir isso hoje (uma posição fixa bem
 * distante, sem pendentes soltos pra preencher o meio caminho), e é
 * exatamente o caso que o arrasto do grid explora ao mover a última matéria
 * pra fora de um semestre. Ver
 * docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
export function compactarSemestres(
  semestres: SemestreProjetado[],
  primeiroSemestre: string,
): SemestreProjetado[] {
  const naoVazios = semestres.filter((semestre) => semestre.componentes.length > 0);
  let semestre = primeiroSemestre;
  return naoVazios.map((atual) => {
    const renomeado = { ...atual, semestre };
    semestre = proximoSemestre(semestre);
    return renomeado;
  });
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd backend && npx jest projetor.spec.ts -t compactarSemestres`
Expected: PASS — 5 testes.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/curriculo/projetor.ts src/curriculo/projetor.spec.ts
git commit -m "feat(curriculo): compactarSemestres remove e renumera semestres vazios

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Backend — usar `compactarSemestres` em `montarProjecao`

**Files:**
- Modify: `backend/src/curriculo/projecao-trajetoria.ts:195-202`
- Test: `backend/src/curriculo/projecao-trajetoria.spec.ts`

**Interfaces:**
- Consumes: `compactarSemestres` (Task 1), `alocar`, `derramarHorasGenericas` — sem mudança de assinatura.
- Produces: `montarProjecao` — mesma assinatura pública, agora sem semestre vazio no meio da resposta.

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao final do `describe('montarProjecao', ...)` em `backend/src/curriculo/projecao-trajetoria.spec.ts` (antes do `});` que fecha o describe):

```ts
  it('não deixa semestre vazio no meio quando um override pula longe', () => {
    // Sem nenhum pendente solto pra preencher o caminho, `alocar` empurraria
    // 2026.2, 2027.1 e 2027.2 vazios até alcançar o override em 2028.1.
    const projecao = montarProjecao(
      estrutura([componente('B', 1)]),
      historico({
        pendentesObrigatorios: [{ codigo: 'B', nome: 'B', cargaHoraria: 60, matriculado: false }],
      }),
      SEM_MARCOS,
      [{ codigo: 'B', nome: 'B', cargaHoraria: 60, semestre: '2028.1' }],
    );

    expect(projecao.semestres).toHaveLength(1);
    expect(projecao.semestres[0].semestre).toBe('2026.2');
    expect(projecao.semestres[0].componentes[0].codigo).toBe('B');
  });

  it('renumera dois overrides distantes mantendo a ordem entre eles', () => {
    const projecao = montarProjecao(
      estrutura([componente('B', 1), componente('C', 2)]),
      historico({
        pendentesObrigatorios: [
          { codigo: 'B', nome: 'B', cargaHoraria: 60, matriculado: false },
          { codigo: 'C', nome: 'C', cargaHoraria: 60, matriculado: false },
        ],
      }),
      SEM_MARCOS,
      [
        { codigo: 'B', nome: 'B', cargaHoraria: 60, semestre: '2027.1' },
        { codigo: 'C', nome: 'C', cargaHoraria: 60, semestre: '2029.1' },
      ],
    );

    expect(projecao.semestres.map((s) => s.semestre)).toEqual(['2026.2', '2027.1']);
    expect(projecao.semestres[0].componentes[0].codigo).toBe('B');
    expect(projecao.semestres[1].componentes[0].codigo).toBe('C');
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest projecao-trajetoria.spec.ts -t "não deixa semestre vazio"`
Expected: FAIL — `projecao.semestres` tem mais de 1 entrada (as vazias ainda aparecem).

- [ ] **Step 3: Implementar a chamada em `montarProjecao`**

Em `backend/src/curriculo/projecao-trajetoria.ts`, ajuste o import e a linha 195:

```ts
import { alocar, compactarSemestres, type SemestreProjetado } from './projetor';
```

E troque:

```ts
  const alocados = alocar(fila, fixos, codigosConcluidos(historico, marcos), primeiro, teto);
  const semestres = derramarHorasGenericas(
    alocados,
```

por:

```ts
  const alocados = compactarSemestres(
    alocar(fila, fixos, codigosConcluidos(historico, marcos), primeiro, teto),
    primeiro,
  );
  const semestres = derramarHorasGenericas(
    alocados,
```

- [ ] **Step 4: Rodar a suíte inteira do arquivo e confirmar que passa**

Run: `cd backend && npx jest projecao-trajetoria.spec.ts`
Expected: PASS — todos os testes, incluindo os dois novos e os pré-existentes (a compactação não deve mudar nenhum resultado onde não havia vazio).

- [ ] **Step 5: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/curriculo/projecao-trajetoria.ts src/curriculo/projecao-trajetoria.spec.ts
git commit -m "feat(curriculo): montarProjecao nunca devolve semestre futuro vazio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Mobile — mirror de `proximoSemestre`

**Files:**
- Create: `mobile/src/lib/semestre.ts`
- Test: `mobile/src/lib/semestre.test.ts`

**Interfaces:**
- Produces: `export function proximoSemestre(semestre: string): string` — usado por `mobile/src/lib/drag-grid.ts` (Task 4).

- [ ] **Step 1: Escrever o teste que falha**

Crie `mobile/src/lib/semestre.test.ts`:

```ts
import { proximoSemestre } from "./semestre";

describe("proximoSemestre", () => {
  it("avança de .1 para .2 no mesmo ano", () => {
    expect(proximoSemestre("2026.1")).toBe("2026.2");
  });

  it("avança de .2 para .1 do ano seguinte", () => {
    expect(proximoSemestre("2026.2")).toBe("2027.1");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd mobile && npx jest src/lib/semestre.test.ts`
Expected: FAIL — módulo `./semestre` não existe.

- [ ] **Step 3: Implementar**

Crie `mobile/src/lib/semestre.ts`:

```ts
/**
 * Mirrors backend/src/curriculo/semestre.ts's proximoSemestre — só a função
 * que esta tela precisa no client, pra rotular o quadradinho pontilhado
 * extra do grid de arrasto antes de o servidor ter qualquer opinião sobre
 * ele.
 */
export function proximoSemestre(semestre: string): string {
  const [ano, periodo] = semestre.split(".").map(Number);
  return periodo === 1 ? `${ano}.2` : `${ano + 1}.1`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd mobile && npx jest src/lib/semestre.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/lib/semestre.ts src/lib/semestre.test.ts
git commit -m "feat(trajetoria): proximoSemestre no client, espelhando o backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Mobile — geometria pura do grid (`drag-grid.ts`)

**Files:**
- Create: `mobile/src/lib/drag-grid.ts`
- Test: `mobile/src/lib/drag-grid.test.ts`

**Interfaces:**
- Consumes: `proximoSemestre` de `./semestre` (Task 3).
- Produces:
  - `export interface Retangulo { id: string; x: number; y: number; width: number; height: number }`
  - `export function quadradinhoNoPonto(retangulos: Retangulo[], ponto: { x: number; y: number }): string | null`
  - `export const REMOVER_DO_PLANO = "__remover_do_plano__"`
  - `export interface QuadradinhoGrid { id: string; rotulo: string; desabilitado: boolean; pontilhado: boolean }`
  - `export function quadradinhosDoGrid(semestresProjetados: string[], semestreAtual: string, manual: boolean): QuadradinhoGrid[]`
  - `export const TAMANHO_QUADRADINHO = 96`, `export const ESPACO_QUADRADINHO = 12`, `export const COLUNAS_GRID = 3`
  - `export interface QuadradinhoPosicionado extends QuadradinhoGrid, Retangulo {}`
  - `export function posicionarQuadradinhos(quadradinhos: QuadradinhoGrid[], origemX: number, origemY: number): QuadradinhoPosicionado[]`
  - Usados por `mobile/src/lib/arrasto-semestre-context.tsx` e `mobile/src/components/SemestreDragGrid.tsx` (Tasks 6 e 7).

- [ ] **Step 1: Escrever os testes que falham**

Crie `mobile/src/lib/drag-grid.test.ts`:

```ts
import {
  COLUNAS_GRID,
  ESPACO_QUADRADINHO,
  REMOVER_DO_PLANO,
  TAMANHO_QUADRADINHO,
  posicionarQuadradinhos,
  quadradinhoNoPonto,
  quadradinhosDoGrid,
  type Retangulo,
} from "./drag-grid";

describe("quadradinhoNoPonto", () => {
  const retangulos: Retangulo[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 100, y: 0, width: 100, height: 100 },
  ];

  it("acerta o retângulo que contém o ponto", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 50, y: 50 })).toBe("a");
    expect(quadradinhoNoPonto(retangulos, { x: 150, y: 50 })).toBe("b");
  });

  it("retorna null quando o ponto está fora de tudo", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 500, y: 500 })).toBeNull();
  });

  it("na sobreposição, o último da lista ganha", () => {
    const sobrepostos: Retangulo[] = [
      { id: "baixo", x: 0, y: 0, width: 100, height: 100 },
      { id: "cima", x: 0, y: 0, width: 100, height: 100 },
    ];
    expect(quadradinhoNoPonto(sobrepostos, { x: 10, y: 10 })).toBe("cima");
  });

  it("borda inclusiva", () => {
    expect(quadradinhoNoPonto(retangulos, { x: 100, y: 0 })).toBe("b");
  });
});

describe("quadradinhosDoGrid", () => {
  it("um quadradinho por semestre projetado, mais um pontilhado no fim", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2", "2027.1"], "2026.2", false);

    expect(quadradinhos.map((q) => q.id)).toEqual(["2026.2", "2027.1", "2027.2"]);
    expect(quadradinhos[2].pontilhado).toBe(true);
    expect(quadradinhos[0].pontilhado).toBe(false);
  });

  it("desabilita o quadradinho do semestre atual do card", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2", "2027.1"], "2027.1", false);

    expect(quadradinhos.find((q) => q.id === "2027.1")?.desabilitado).toBe(true);
    expect(quadradinhos.find((q) => q.id === "2026.2")?.desabilitado).toBe(false);
  });

  it("inclui 'tirar do plano' só quando manual", () => {
    const semManual = quadradinhosDoGrid(["2026.2"], "2026.2", false);
    const comManual = quadradinhosDoGrid(["2026.2"], "2026.2", true);

    expect(semManual.some((q) => q.id === REMOVER_DO_PLANO)).toBe(false);
    expect(comManual.some((q) => q.id === REMOVER_DO_PLANO)).toBe(true);
  });
});

describe("posicionarQuadradinhos", () => {
  it("preenche em COLUNAS_GRID colunas, esquerda pra direita, cima pra baixo", () => {
    const quadradinhos = quadradinhosDoGrid(
      Array.from({ length: COLUNAS_GRID + 1 }, (_, i) => `202${i}.1`),
      "2020.1",
      false,
    );
    const posicionados = posicionarQuadradinhos(quadradinhos, 0, 0);

    expect(posicionados[0]).toMatchObject({ x: 0, y: 0 });
    expect(posicionados[1]).toMatchObject({ x: TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO, y: 0 });
    // O (COLUNAS_GRID)-ésimo item (índice COLUNAS_GRID) começa a segunda linha.
    expect(posicionados[COLUNAS_GRID]).toMatchObject({ x: 0, y: TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO });
  });

  it("respeita a origem informada", () => {
    const quadradinhos = quadradinhosDoGrid(["2026.2"], "2026.2", false);
    const [primeiro] = posicionarQuadradinhos(quadradinhos, 20, 30);

    expect(primeiro.x).toBe(20);
    expect(primeiro.y).toBe(30);
    expect(primeiro.width).toBe(TAMANHO_QUADRADINHO);
    expect(primeiro.height).toBe(TAMANHO_QUADRADINHO);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd mobile && npx jest src/lib/drag-grid.test.ts`
Expected: FAIL — módulo `./drag-grid` não existe.

- [ ] **Step 3: Implementar**

Crie `mobile/src/lib/drag-grid.ts`:

```ts
import { proximoSemestre } from "./semestre";

/** Um alvo de soltura em coordenadas de tela — ver quadradinhoNoPonto. */
export interface Retangulo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Qual retângulo contém o ponto, ou null se nenhum contém. Em sobreposição
 * (não deveria acontecer no grid real, mas a função não assume isso), o
 * último da lista ganha — a mesma regra de "o que está por cima" que
 * `posicionarQuadradinhos` usa pra desenhar.
 */
export function quadradinhoNoPonto(
  retangulos: Retangulo[],
  ponto: { x: number; y: number },
): string | null {
  let achado: string | null = null;
  for (const retangulo of retangulos) {
    const dentro =
      ponto.x >= retangulo.x &&
      ponto.x <= retangulo.x + retangulo.width &&
      ponto.y >= retangulo.y &&
      ponto.y <= retangulo.y + retangulo.height;
    if (dentro) {
      achado = retangulo.id;
    }
  }
  return achado;
}

/** Sentinela pro quadradinho de "tirar do plano" — não é um semestre real. */
export const REMOVER_DO_PLANO = "__remover_do_plano__";

export interface QuadradinhoGrid {
  id: string;
  rotulo: string;
  /** O semestre atual do card sendo arrastado — soltar aqui não faz nada. */
  desabilitado: boolean;
  /** O quadradinho extra: soltar aqui cria um semestre que ainda não existe. */
  pontilhado: boolean;
}

/**
 * Os quadradinhos do grid de arrasto: um por semestre já projetado, mais um
 * pontilhado pro próximo semestre que ainda não existe, mais (só quando a
 * matéria já foi movida manualmente) o de tirar do plano.
 */
export function quadradinhosDoGrid(
  semestresProjetados: string[],
  semestreAtual: string,
  manual: boolean,
): QuadradinhoGrid[] {
  const ultimo = semestresProjetados[semestresProjetados.length - 1] ?? semestreAtual;
  const proximo = proximoSemestre(ultimo);
  const quadradinhos: QuadradinhoGrid[] = [
    ...semestresProjetados.map((semestre) => ({
      id: semestre,
      rotulo: semestre,
      desabilitado: semestre === semestreAtual,
      pontilhado: false,
    })),
    { id: proximo, rotulo: proximo, desabilitado: false, pontilhado: true },
  ];
  if (manual) {
    quadradinhos.push({
      id: REMOVER_DO_PLANO,
      rotulo: "Tirar do plano",
      desabilitado: false,
      pontilhado: false,
    });
  }
  return quadradinhos;
}

export const TAMANHO_QUADRADINHO = 96;
export const ESPACO_QUADRADINHO = 12;
export const COLUNAS_GRID = 3;

export interface QuadradinhoPosicionado extends QuadradinhoGrid, Retangulo {}

/**
 * Posições em grid fixo de COLUNAS_GRID colunas, calculadas em JS puro — de
 * propósito, sem depender de `onLayout`/`measureInWindow`. Isso é o que
 * torna o hit-test determinístico tanto em produção quanto em teste: a
 * mesma função decide onde cada quadradinho é desenhado (SemestreDragGrid) e
 * onde ele está pra fins de colisão (quadradinhoNoPonto).
 */
export function posicionarQuadradinhos(
  quadradinhos: QuadradinhoGrid[],
  origemX: number,
  origemY: number,
): QuadradinhoPosicionado[] {
  return quadradinhos.map((quadradinho, indice) => {
    const coluna = indice % COLUNAS_GRID;
    const linha = Math.floor(indice / COLUNAS_GRID);
    return {
      ...quadradinho,
      x: origemX + coluna * (TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO),
      y: origemY + linha * (TAMANHO_QUADRADINHO + ESPACO_QUADRADINHO),
      width: TAMANHO_QUADRADINHO,
      height: TAMANHO_QUADRADINHO,
    };
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd mobile && npx jest src/lib/drag-grid.test.ts`
Expected: PASS — 9 testes.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/lib/drag-grid.ts src/lib/drag-grid.test.ts
git commit -m "feat(trajetoria): geometria pura do grid de arrasto de semestres

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Mobile — habilitar testes de gesture-handler no Jest

**Files:**
- Modify: `mobile/package.json`

**Interfaces:**
- Consumes: `react-native-gesture-handler/jestSetup.js` (já presente em `node_modules`, é dependência existente).
- Produces: `fireGestureHandler`/`getByGestureTestId` de `react-native-gesture-handler/jest-utils` passam a funcionar nos testes da Task 9.

- [ ] **Step 1: Editar o bloco `jest` de `mobile/package.json`**

Ache:

```json
  "jest": {
    "preset": "jest-expo",
    "transformIgnorePatterns": [
```

Troque por:

```json
  "jest": {
    "preset": "jest-expo",
    "setupFiles": [
      "<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js"
    ],
    "transformIgnorePatterns": [
```

- [ ] **Step 2: Rodar a suíte inteira do mobile e confirmar que nada quebrou**

Run: `cd mobile && npm test`
Expected: PASS — mesmos resultados de antes (esse setup só adiciona mocks, não muda comportamento de nenhum teste existente).

- [ ] **Step 3: Commit**

```bash
cd mobile && git add package.json
git commit -m "test(mobile): habilita jestSetup do react-native-gesture-handler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Mobile — `ArrastoSemestreProvider` (contexto de coordenação)

**Files:**
- Create: `mobile/src/lib/arrasto-semestre-context.tsx`
- Test: `mobile/src/lib/arrasto-semestre-context.test.tsx`

**Interfaces:**
- Consumes: `quadradinhoNoPonto`, `Retangulo`, `REMOVER_DO_PLANO` de `./drag-grid` (Task 4); `ComponenteProjetado` de `./types`.
- Produces:
  - `export interface ArrastoAtivo { componente: ComponenteProjetado; semestreAtual: string }`
  - `export function ArrastoSemestreProvider({ onSoltar, children }: { onSoltar: (componente: ComponenteProjetado, destino: string | null) => void; children: ReactNode }): JSX.Element`
  - `export function useArrastoSemestre(): { arrasto: ArrastoAtivo | null; fingerX: SharedValue<number>; fingerY: SharedValue<number>; iniciar: (arrasto: ArrastoAtivo) => void; registrarQuadradinhos: (retangulos: Retangulo[]) => void; finalizar: (x: number, y: number) => void }`
  - Usados por `CardProjetado` e `SemestreDragGrid` (Tasks 7 e 8).

- [ ] **Step 1: Escrever os testes que falham**

Crie `mobile/src/lib/arrasto-semestre-context.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { ArrastoSemestreProvider, useArrastoSemestre } from "./arrasto-semestre-context";
import type { ComponenteProjetado } from "./types";

const COMPONENTE: ComponenteProjetado = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  periodo: 4,
  atrasada: false,
  manual: false,
  preRequisitoNaoVerificado: false,
};

/** Expõe os métodos do contexto como botões, pra exercitar sem depender de gesto real. */
function Sonda(): JSX.Element {
  const { arrasto, iniciar, registrarQuadradinhos, finalizar } = useArrastoSemestre();
  return (
    <>
      <Text testID="estado">{arrasto ? arrasto.componente.codigo : "nenhum"}</Text>
      <Pressable
        testID="iniciar"
        onPress={() => iniciar({ componente: COMPONENTE, semestreAtual: "2026.2" })}
      >
        <Text>iniciar</Text>
      </Pressable>
      <Pressable
        testID="registrar"
        onPress={() =>
          registrarQuadradinhos([{ id: "2027.1", x: 0, y: 0, width: 100, height: 100 }])
        }
      >
        <Text>registrar</Text>
      </Pressable>
      <Pressable testID="soltar-dentro" onPress={() => finalizar(50, 50)}>
        <Text>soltar dentro</Text>
      </Pressable>
      <Pressable testID="soltar-fora" onPress={() => finalizar(999, 999)}>
        <Text>soltar fora</Text>
      </Pressable>
    </>
  );
}

describe("ArrastoSemestreProvider", () => {
  it("chama onSoltar com o destino quando solta dentro de um quadradinho registrado", () => {
    const onSoltar = jest.fn();
    render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    act(() => fireEvent.press(screen.getByTestId("iniciar")));
    expect(screen.getByTestId("estado")).toHaveTextContent("MATA60");

    act(() => fireEvent.press(screen.getByTestId("registrar")));
    act(() => fireEvent.press(screen.getByTestId("soltar-dentro")));

    expect(onSoltar).toHaveBeenCalledWith(COMPONENTE, "2027.1");
    expect(screen.getByTestId("estado")).toHaveTextContent("nenhum");
  });

  it("não chama onSoltar quando solta fora de qualquer quadradinho", () => {
    const onSoltar = jest.fn();
    render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    act(() => fireEvent.press(screen.getByTestId("iniciar")));
    act(() => fireEvent.press(screen.getByTestId("registrar")));
    act(() => fireEvent.press(screen.getByTestId("soltar-fora")));

    expect(onSoltar).not.toHaveBeenCalled();
    expect(screen.getByTestId("estado")).toHaveTextContent("nenhum");
  });

  it("não chama onSoltar ao soltar sobre o próprio semestre atual", () => {
    const onSoltar = jest.fn();
    render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    act(() => fireEvent.press(screen.getByTestId("iniciar")));
    act(() =>
      fireEvent.press(
        screen.getByTestId("registrar"), // registra "2027.1"; agora sobrescreve pro semestre atual
      ),
    );
    // Redefine o único retângulo registrado para o próprio semestre atual do arrasto.
    act(() => fireEvent.press(screen.getByTestId("registrar")));

    expect(onSoltar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd mobile && npx jest src/lib/arrasto-semestre-context.test.tsx`
Expected: FAIL — módulo `./arrasto-semestre-context` não existe.

- [ ] **Step 3: Implementar**

Crie `mobile/src/lib/arrasto-semestre-context.tsx`:

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { quadradinhoNoPonto, REMOVER_DO_PLANO, type Retangulo } from "@/lib/drag-grid";
import type { ComponenteProjetado } from "@/lib/types";

export interface ArrastoAtivo {
  componente: ComponenteProjetado;
  semestreAtual: string;
}

interface ArrastoSemestreContextValue {
  arrasto: ArrastoAtivo | null;
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  iniciar: (arrasto: ArrastoAtivo) => void;
  registrarQuadradinhos: (retangulos: Retangulo[]) => void;
  finalizar: (x: number, y: number) => void;
}

const ArrastoSemestreContext = createContext<ArrastoSemestreContextValue | null>(null);

/**
 * Coordena o arrasto de um CardProjetado até um quadradinho do
 * SemestreDragGrid: os dois vivem em pontos diferentes da árvore (o card
 * dentro da ScrollView da Trajetória, o grid num Modal por cima de tudo) e
 * nenhum é pai do outro — daí o contexto em vez de props. Ver
 * docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
export function ArrastoSemestreProvider({
  onSoltar,
  children,
}: {
  onSoltar: (componente: ComponenteProjetado, destino: string | null) => void;
  children: ReactNode;
}): JSX.Element {
  const [arrasto, setArrasto] = useState<ArrastoAtivo | null>(null);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  // Ref, não state: os quadradinhos se registram de uma vez a cada abertura
  // do grid (ver SemestreDragGrid), e nada aqui precisa re-renderizar por
  // isso — só finalizar() lê o mapa, no fim do gesto.
  const quadradinhos = useRef<Retangulo[]>([]);

  const iniciar = useCallback((novo: ArrastoAtivo) => {
    quadradinhos.current = [];
    setArrasto(novo);
  }, []);

  const registrarQuadradinhos = useCallback((retangulos: Retangulo[]) => {
    quadradinhos.current = retangulos;
  }, []);

  const finalizar = useCallback(
    (x: number, y: number) => {
      setArrasto((atual) => {
        if (!atual) {
          return null;
        }
        const destino = quadradinhoNoPonto(quadradinhos.current, { x, y });
        if (destino !== null && destino !== atual.semestreAtual) {
          onSoltar(atual.componente, destino === REMOVER_DO_PLANO ? null : destino);
        }
        return null;
      });
    },
    [onSoltar],
  );

  return (
    <ArrastoSemestreContext.Provider
      value={{ arrasto, fingerX, fingerY, iniciar, registrarQuadradinhos, finalizar }}
    >
      {children}
    </ArrastoSemestreContext.Provider>
  );
}

export function useArrastoSemestre(): ArrastoSemestreContextValue {
  const valor = useContext(ArrastoSemestreContext);
  if (!valor) {
    throw new Error("useArrastoSemestre usado fora de ArrastoSemestreProvider");
  }
  return valor;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd mobile && npx jest src/lib/arrasto-semestre-context.test.tsx`
Expected: PASS — 3 testes.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/lib/arrasto-semestre-context.tsx src/lib/arrasto-semestre-context.test.tsx
git commit -m "feat(trajetoria): ArrastoSemestreProvider coordena card e grid pelo contexto

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Mobile — `SemestreDragGrid` (overlay)

**Files:**
- Create: `mobile/src/components/SemestreDragGrid.tsx`
- Test: `mobile/src/components/SemestreDragGrid.test.tsx`

**Interfaces:**
- Consumes: `useArrastoSemestre` (Task 6); `quadradinhosDoGrid`, `posicionarQuadradinhos`, `COLUNAS_GRID`, `TAMANHO_QUADRADINHO`, `ESPACO_QUADRADINHO` de `@/lib/drag-grid` (Task 4).
- Produces: `export function SemestreDragGrid({ semestresProjetados }: { semestresProjetados: string[] }): JSX.Element | null` — montado por `ReadyTrajetoria` (Task 8).

- [ ] **Step 1: Escrever os testes que falham**

Crie `mobile/src/components/SemestreDragGrid.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { ArrastoSemestreProvider, useArrastoSemestre } from "@/lib/arrasto-semestre-context";
import { SemestreDragGrid } from "./SemestreDragGrid";
import type { ComponenteProjetado } from "@/lib/types";

const COMPONENTE: ComponenteProjetado = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  periodo: 4,
  atrasada: false,
  manual: false,
  preRequisitoNaoVerificado: false,
};

function GatilhoDeArrasto(): JSX.Element {
  const { iniciar } = useArrastoSemestre();
  return (
    <Pressable
      testID="iniciar"
      onPress={() => iniciar({ componente: COMPONENTE, semestreAtual: "2026.2" })}
    >
      <Text>iniciar</Text>
    </Pressable>
  );
}

describe("SemestreDragGrid", () => {
  it("não renderiza nada sem arrasto ativo", () => {
    render(
      <ArrastoSemestreProvider onSoltar={jest.fn()}>
        <SemestreDragGrid semestresProjetados={["2026.2", "2027.1"]} />
      </ArrastoSemestreProvider>,
    );

    expect(screen.queryByTestId("semestre-drag-grid")).toBeNull();
  });

  it("mostra um quadradinho por semestre projetado mais o pontilhado extra", () => {
    render(
      <ArrastoSemestreProvider onSoltar={jest.fn()}>
        <GatilhoDeArrasto />
        <SemestreDragGrid semestresProjetados={["2026.2", "2027.1"]} />
      </ArrastoSemestreProvider>,
    );

    act(() => fireEvent.press(screen.getByTestId("iniciar")));

    expect(screen.getByTestId("semestre-drag-grid")).toBeTruthy();
    expect(screen.getByTestId("quadrado-2026.2")).toBeTruthy();
    expect(screen.getByTestId("quadrado-2027.1")).toBeTruthy();
    // Próximo depois de 2027.1 é 2027.2 — o pontilhado extra.
    expect(screen.getByTestId("quadrado-2027.2")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd mobile && npx jest src/components/SemestreDragGrid.test.tsx`
Expected: FAIL — módulo `./SemestreDragGrid` não existe.

- [ ] **Step 3: Implementar**

Crie `mobile/src/components/SemestreDragGrid.tsx`:

```tsx
import { useEffect } from "react";
import { Modal, View, useWindowDimensions } from "react-native";
import { Typography } from "heroui-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useArrastoSemestre } from "@/lib/arrasto-semestre-context";
import {
  COLUNAS_GRID,
  ESPACO_QUADRADINHO,
  TAMANHO_QUADRADINHO,
  posicionarQuadradinhos,
  quadradinhosDoGrid,
} from "@/lib/drag-grid";

/**
 * O overlay full-screen que aparece enquanto o dedo segura um CardProjetado.
 * Não é filho do card — os dois só se falam pelo ArrastoSemestreProvider, e
 * é por isso que a posição de cada quadradinho é calculada aqui (geometria
 * pura, ver posicionarQuadradinhos) em vez de medida via onLayout: o mesmo
 * cálculo decide onde desenhar e onde a colisão de soltura procura.
 */
export function SemestreDragGrid({
  semestresProjetados,
}: {
  semestresProjetados: string[];
}): JSX.Element | null {
  const { arrasto, registrarQuadradinhos, finalizar, fingerX, fingerY } = useArrastoSemestre();
  const { width, height } = useWindowDimensions();

  const quadradinhos = arrasto
    ? quadradinhosDoGrid(semestresProjetados, arrasto.semestreAtual, arrasto.componente.manual)
    : [];
  const larguraGrid = COLUNAS_GRID * TAMANHO_QUADRADINHO + (COLUNAS_GRID - 1) * ESPACO_QUADRADINHO;
  const linhas = Math.max(1, Math.ceil(quadradinhos.length / COLUNAS_GRID));
  const alturaGrid = linhas * TAMANHO_QUADRADINHO + (linhas - 1) * ESPACO_QUADRADINHO;
  const origemX = (width - larguraGrid) / 2;
  const origemY = (height - alturaGrid) / 2;
  const posicionados = posicionarQuadradinhos(quadradinhos, origemX, origemY);
  // Serializado pra dependência estável do efeito — o array de objetos é
  // recriado a cada render.
  const chaveQuadradinhos = posicionados.map((q) => `${q.id}:${q.x}:${q.y}`).join("|");

  useEffect(() => {
    if (arrasto) {
      registrarQuadradinhos(posicionados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrasto, chaveQuadradinhos]);

  const estiloFantasma = useAnimatedStyle(() => ({
    left: fingerX.value - TAMANHO_QUADRADINHO / 2,
    top: fingerY.value - TAMANHO_QUADRADINHO / 2,
  }));

  if (!arrasto) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => finalizar(-1, -1)}
    >
      <View testID="semestre-drag-grid" className="flex-1 bg-black/70">
        {posicionados.map((quadradinho) => (
          <View
            key={quadradinho.id}
            testID={`quadrado-${quadradinho.id}`}
            style={{
              position: "absolute",
              left: quadradinho.x,
              top: quadradinho.y,
              width: quadradinho.width,
              height: quadradinho.height,
            }}
            className={`rounded-2xl items-center justify-center px-2 ${
              quadradinho.desabilitado
                ? "bg-white/5 opacity-40"
                : quadradinho.pontilhado
                  ? "border border-dashed border-white/30"
                  : "bg-surface-secondary"
            }`}
          >
            <Typography.Paragraph type="body-sm" className="font-mono text-center">
              {quadradinho.rotulo}
            </Typography.Paragraph>
          </View>
        ))}
        <Animated.View
          testID="card-fantasma"
          pointerEvents="none"
          style={[{ position: "absolute", width: TAMANHO_QUADRADINHO }, estiloFantasma]}
        >
          <View className="rounded-2xl bg-surface-secondary p-3">
            <Typography.Paragraph weight="medium">{arrasto.componente.nome}</Typography.Paragraph>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd mobile && npx jest src/components/SemestreDragGrid.test.tsx`
Expected: PASS — 2 testes.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/components/SemestreDragGrid.tsx src/components/SemestreDragGrid.test.tsx
git commit -m "feat(trajetoria): SemestreDragGrid, overlay do arrasto de semestres

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Mobile — `CardProjetado` vira arrastável, `ReadyTrajetoria` monta o Provider e o grid

**Files:**
- Modify: `mobile/src/screens/TrajetoriaTab.tsx`

**Interfaces:**
- Consumes: `ArrastoSemestreProvider`, `useArrastoSemestre` (Task 6); `SemestreDragGrid` (Task 7).
- Produces: `CardProjetado` sem `Menu`; `LinhaDoTempo` sem prop `onMover`; comportamento externo de `moverComponente`/`putPlano` inalterado.

- [ ] **Step 1: Trocar os imports do topo do arquivo**

Em `mobile/src/screens/TrajetoriaTab.tsx`, troque:

```tsx
import { useRouter } from "expo-router";
import { Button, Menu, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { AppIcon } from "@/components/AppIcon";
```

por:

```tsx
import { useRouter } from "expo-router";
import { Button, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { LinearTransition, runOnJS } from "react-native-reanimated";

import { AppIcon } from "@/components/AppIcon";
import { SemestreDragGrid } from "@/components/SemestreDragGrid";
import { ArrastoSemestreProvider, useArrastoSemestre } from "@/lib/arrasto-semestre-context";
```

- [ ] **Step 2: Envolver `ReadyTrajetoria` no `ArrastoSemestreProvider` e montar o grid**

Troque o `return` de `ReadyTrajetoria` (linhas 272-334 do arquivo original) — o `<>...</>` vira `<ArrastoSemestreProvider>`, e `<SemestreDragGrid />` entra logo depois de `<LinhaDoTempo />`:

```tsx
  return (
    <ArrastoSemestreProvider onSoltar={onMover}>
      {/* The plain "sincronizado em" line is gone — that freshness now lives
          on Início's badge, fed by every screen that reads the histórico
          (see sync-freshness-context). Only the actionable nudge survives
          here, since it's not about freshness but about a specific
          missing-notas gap. */}
      {desatualizado ? (
        <Typography.Paragraph type="body-xs" color="muted">
          O semestre acabou e seu histórico ainda tem matérias em curso — sincronize em Perfil para ver as
          notas.
        </Typography.Paragraph>
      ) : null}

      {/* Two beats instead of one sentence: the forecast, and — only when
          there is one — the debt. The old line packed the atraso count, the
          semestre and the delta into a single muted paragraph, and the number
          the student actually came for got buried in the middle of it.
          `items-start` keeps the badge hugging its text instead of stretching
          the row. */}
      {projecao ? (
        <View className="gap-2 items-start">
          <Typography.Paragraph type="body-sm" color="muted">
            {`Neste ritmo, você conclui em ${projecao.conclusaoProjetada}.`}
          </Typography.Paragraph>
          {projecao.atrasadas > 0 ? (
            <View testID="badge-atrasadas" className="rounded-full bg-danger-soft px-2 py-1">
              <Typography.Paragraph type="body-xs" className="text-danger">
                {`${projecao.atrasadas} ${projecao.atrasadas === 1 ? "atrasada" : "atrasadas"}`}
              </Typography.Paragraph>
            </View>
          ) : null}
          {projecao.alemDoPrazoMaximo ? (
            <Typography.Paragraph type="body-sm" color="muted">
              Nesse ritmo, a conclusão passa do prazo máximo do seu histórico.
            </Typography.Paragraph>
          ) : null}
        </View>
      ) : null}

      {/* Inline, not a page-swallowing error card: a failed move must not cost
          the student their loaded trajectory — open years, scroll position,
          all of it. It clears itself the moment a move succeeds. */}
      {erroAoMover ? (
        <View className="rounded-2xl bg-danger-soft p-3 flex-row items-center gap-2.5">
          <AppIcon name="IconWarningCircle" size={18} color={mutedColor} />
          <Typography.Paragraph type="body-sm" className="text-danger flex-1">
            {erroAoMover}
          </Typography.Paragraph>
        </View>
      ) : null}

      <LinhaDoTempo
        anos={anos}
        desatualizado={desatualizado}
        marcos={marcos}
        onAbrirVizinhos={onAbrirVizinhos}
      />
      <SemestreDragGrid semestresProjetados={projecao?.semestres.map((semestre) => semestre.semestre) ?? []} />
    </ArrastoSemestreProvider>
  );
}
```

Note que `semestresProjetados`, `conclusaoProjetada` e `onMover` saem das props de `LinhaDoTempo` — `conclusaoProjetada` continua sendo usada dentro do próprio `LinhaDoTempo`, então essa remoção é só de `semestresProjetados` e `onMover` (que não são mais necessários nesse nível: o grid lê `semestresProjetados` direto de `projecao`, e `onMover` virou `onSoltar` do Provider). Ajuste a assinatura de `LinhaDoTempo` de acordo — próximo passo.

- [ ] **Step 3: Simplificar a assinatura de `LinhaDoTempo`**

Troque:

```tsx
function LinhaDoTempo({
  anos,
  desatualizado,
  marcos,
  semestresProjetados,
  conclusaoProjetada,
  onAbrirVizinhos,
  onMover,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  marcos: MarcosSemestralizacao | null;
  semestresProjetados: string[];
  conclusaoProjetada: string | null;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
  onMover: (componente: ComponenteProjetado, semestre: string | null) => void;
}): JSX.Element {
```

por:

```tsx
function LinhaDoTempo({
  anos,
  desatualizado,
  marcos,
  onAbrirVizinhos,
}: {
  anos: AnoTrajetoria[];
  desatualizado: boolean;
  marcos: MarcosSemestralizacao | null;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
```

Espere — `conclusaoProjetada` ainda é lido no JSX do "Linha de chegada" mais abaixo (`{conclusaoProjetada ? ... }`). Recupere esse valor de dentro de `anos` em vez de receber por prop: `anos` (de `anosDaProjecao`) já carrega os semestres projetados em `anoBloco.projetados`. Adicione, logo no topo do corpo de `LinhaDoTempo` (antes do `return`):

```tsx
  const conclusaoProjetada =
    anos.flatMap((anoBloco) => anoBloco.projetados).at(-1)?.semestre ?? null;
```

Isso reproduz exatamente o mesmo dado que antes vinha como prop de `ReadyTrajetoria` (`projecao?.conclusaoProjetada`), já que o último semestre projetado em `anos` é o mesmo último semestre da lista compactada que o backend devolve. Se preferir manter `conclusaoProjetada` explícito por clareza, receba-o como prop normalmente a partir de `projecao?.conclusaoProjetada ?? null` — ambas as formas são equivalentes; escolha a prop explícita se achar mais direto de ler (nesse caso, mantenha esse único parâmetro em `LinhaDoTempo` e no `<LinhaDoTempo .../>` do Step 2).

- [ ] **Step 4: Remover `onMover` da chamada de `CardProjetado` dentro de `LinhaDoTempo`, adicionar `semestreAtual`**

Troque:

```tsx
                    {semestre.componentes.map((componente) => (
                      <CardProjetado
                        key={`${semestre.semestre}-${componente.codigo}`}
                        componente={componente}
                        destinos={semestresProjetados.filter((destino) => destino !== semestre.semestre)}
                        mutedColor={mutedColor}
                        onAbrirVizinhos={onAbrirVizinhos}
                        onMover={onMover}
                      />
                    ))}
```

por:

```tsx
                    {semestre.componentes.map((componente) => (
                      <CardProjetado
                        key={`${semestre.semestre}-${componente.codigo}`}
                        componente={componente}
                        semestreAtual={semestre.semestre}
                        onAbrirVizinhos={onAbrirVizinhos}
                      />
                    ))}
```

- [ ] **Step 5: Reescrever `CardProjetado`**

Troque o componente inteiro (linhas 565-672 do arquivo original) por:

```tsx
/**
 * A componente the projector placed in a future semestre: no nota to show yet
 * and no density meter — the card is a placeholder for work not yet done, not
 * a record of work already measured. An atrasada carries the same status card
 * `MateriaCard` hangs off a deviating componente, in the danger tone a
 * reprovada uses rather than the warning tone of a trancada: a matéria whose
 * período has already passed is a hole in the trajectory, not a pause the
 * student chose. The badge does not name the período it came from — the
 * student is looking at where the matéria goes now, and which período the
 * grade originally wanted it in changes nothing about that. A tap opens the
 * same árvore de dependências a cursado card would; a long-press-and-drag
 * opens the semestre grid (SemestreDragGrid) via ArrastoSemestreProvider —
 * ver docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
function CardProjetado({
  componente,
  semestreAtual,
  onAbrirVizinhos,
}: {
  componente: ComponenteProjetado;
  semestreAtual: string;
  onAbrirVizinhos: (codigo: string, nome: string) => void;
}): JSX.Element {
  const { arrasto, iniciar, finalizar, fingerX, fingerY } = useArrastoSemestre();
  // Escondido, não desmontado: o card continua existindo (e continua sendo o
  // dono do gesto em andamento) enquanto o fantasma no grid mostra pra onde
  // ele está indo.
  const escondido = arrasto?.componente.codigo === componente.codigo;

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onAbrirVizinhos)(componente.codigo, componente.nome);
  });
  const arrastar = Gesture.Pan()
    .withTestId(`arrasto-${componente.codigo}`)
    .activateAfterLongPress(350)
    .onStart(() => {
      runOnJS(iniciar)({ componente, semestreAtual });
    })
    .onUpdate((event) => {
      fingerX.value = event.absoluteX;
      fingerY.value = event.absoluteY;
    })
    .onEnd((event) => {
      runOnJS(finalizar)(event.absoluteX, event.absoluteY);
    });
  // Race, não Simultaneous: um toque rápido não deve também começar (e
  // depois cancelar) um arrasto, e um arrasto que já começou não deve também
  // navegar quando o dedo finalmente solta.
  const gesto = Gesture.Race(tap, arrastar);

  return (
    <GestureDetector gesture={gesto}>
      <View
        testID={`card-projetado-${componente.codigo}`}
        accessible
        accessibilityRole="button"
        accessibilityLabel={componente.nome}
        className={`gap-0.5 ${escondido ? "opacity-0" : ""}`}
        style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
      >
        {componente.atrasada ? (
          <View
            testID={`atrasada-${componente.codigo}`}
            className="rounded-t-2xl rounded-b-md px-3 py-1.5 bg-danger-soft"
          >
            <Typography.Paragraph type="body-xs" className="text-danger">
              atrasada
            </Typography.Paragraph>
          </View>
        ) : null}
        <View
          className={`flex-1 p-3 justify-between gap-1.5 bg-surface-secondary/40 border border-dashed border-white/20 ${
            componente.atrasada ? "rounded-t-md rounded-b-2xl" : "rounded-2xl"
          }`}
        >
          <View className="gap-0.5">
            <View className="flex-row items-baseline gap-1.5">
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                {componente.codigo}
              </Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted" className="font-mono">
                · {componente.cargaHoraria} h
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph weight="medium">{componente.nome}</Typography.Paragraph>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}
```

- [ ] **Step 6: Rodar o typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: sem erros novos. Se `mutedColor` ficar sem uso em algum escopo que só existia por causa do ícone removido, o TypeScript não acusa (é só uma prop de função, não um `unknown var` — mas confira que nenhum outro lugar dependia da assinatura antiga de `CardProjetado`/`LinhaDoTempo`).

- [ ] **Step 7: Commit**

```bash
cd mobile && git add src/screens/TrajetoriaTab.tsx
git commit -m "feat(trajetoria): CardProjetado arrasta pro grid em vez do menu de calendário

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Mobile — atualizar os testes de integração da tela

**Files:**
- Modify: `mobile/src/__tests__/trajetoria.test.tsx`

**Interfaces:**
- Consumes: `fireGestureHandler`, `getByGestureTestId` de `react-native-gesture-handler/jest-utils` (habilitado na Task 5); testIDs `quadrado-<semestre>`, `card-fantasma`, `semestre-drag-grid` (Task 7).

- [ ] **Step 1: Localizar e remover os três testes obsoletos**

Em `mobile/src/__tests__/trajetoria.test.tsx`, remova os três testes que dependem do `Menu` antigo (identificados na exploração do repo):

- `"mover uma matéria salva a posição e aplica a trajetória que volta"` (usa `mover-MATA60` e `destino-MATA60-2027.1`)
- `"oferece tirar do plano a matéria que o aluno moveu, mandando semestre null"` (usa `tirar-do-plano-MATA60`)
- `"não oferece tirar do plano o que o plano nunca pôs"` (mesmo padrão)

Esses três testes não têm mais equivalente na UI (o `Menu.Trigger`/`Menu.Item` some por completo) — não têm reescrita 1-para-1: viram os novos testes abaixo.

- [ ] **Step 2: Escrever os testes novos que falham**

No lugar dos três removidos, adicione (mesmo `describe`, reaproveitando `comBancoEm`/`BANCO_PROJETADO` já existentes no arquivo):

```tsx
  it("arrastar o card até um quadradinho salva a posição e aplica a trajetória que volta", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));
    jest.mocked(putPlano).mockResolvedValue(comBancoEm("2027.1"));

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    const arrasto = getByGestureTestId("arrasto-MATA60");
    act(() => {
      fireGestureHandler(arrasto, [
        { state: State.BEGAN, translationX: 0, translationY: 0, absoluteX: 10, absoluteY: 10 },
        { state: State.ACTIVE, translationX: 5, translationY: 5, absoluteX: 15, absoluteY: 15 },
      ]);
    });

    // O grid abre com um quadradinho por semestre da projeção, mais o extra.
    expect(screen.getByTestId("semestre-drag-grid")).toBeTruthy();
    expect(screen.getByTestId("quadrado-2027.1")).toBeTruthy();

    // Soltar em cima do quadradinho "2027.1": medir sua posição real e soltar
    // ali dentro — a mesma geometria que posicionarQuadradinhos calcula.
    const quadrado = screen.getByTestId("quadrado-2027.1");
    const { left, top, width, height } = quadrado.props.style;
    const centroX = left + width / 2;
    const centroY = top + height / 2;

    act(() => {
      fireGestureHandler(arrasto, [
        { state: State.END, translationX: 0, translationY: 0, absoluteX: centroX, absoluteY: centroY },
      ]);
    });

    expect(jest.mocked(putPlano)).toHaveBeenCalledWith("token", [
      { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 68, semestre: "2027.1" },
    ]);
    await waitFor(() => expect(screen.queryByTestId("semestre-drag-grid")).toBeNull());
  });

  it("soltar fora de qualquer quadradinho não move nada", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2026.2"));

    await render(<TrajetoriaTab />);
    await screen.findByText("MATA60");

    const arrasto = getByGestureTestId("arrasto-MATA60");
    act(() => {
      fireGestureHandler(arrasto, [
        { state: State.BEGAN, translationX: 0, translationY: 0, absoluteX: 10, absoluteY: 10 },
        { state: State.ACTIVE, translationX: 5, translationY: 5, absoluteX: 15, absoluteY: 15 },
        { state: State.END, translationX: 0, translationY: 0, absoluteX: -999, absoluteY: -999 },
      ]);
    });

    expect(jest.mocked(putPlano)).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("semestre-drag-grid")).toBeNull());
  });

  it("oferece tirar do plano a matéria que o aluno moveu, mandando semestre null", async () => {
    jest.mocked(getTrajetoria).mockResolvedValue(comBancoEm("2027.1"));
    jest.mocked(putPlano).mockResolvedValue(comBancoEm("2026.2"));

    await render(<TrajetoriaTab />);
    await act(async () => {
      fireEvent.press(await screen.findByTestId("ano-2027"));
    });
    await screen.findByText("MATA60");

    const arrasto = getByGestureTestId("arrasto-MATA60");
    act(() => {
      fireGestureHandler(arrasto, [
        { state: State.BEGAN, translationX: 0, translationY: 0, absoluteX: 10, absoluteY: 10 },
        { state: State.ACTIVE, translationX: 5, translationY: 5, absoluteX: 15, absoluteY: 15 },
      ]);
    });

    const remover = screen.getByTestId("quadrado-__remover_do_plano__");
    const { left, top, width, height } = remover.props.style;
    act(() => {
      fireGestureHandler(arrasto, [
        {
          state: State.END,
          translationX: 0,
          translationY: 0,
          absoluteX: left + width / 2,
          absoluteY: top + height / 2,
        },
      ]);
    });

    expect(jest.mocked(putPlano)).toHaveBeenCalledWith("token", [
      { codigo: "MATA60", nome: "BANCO DE DADOS", cargaHoraria: 68, semestre: null },
    ]);
  });
```

Adicione os imports necessários no topo do arquivo, junto aos demais imports de teste:

```tsx
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { State } from "react-native-gesture-handler";
```

- [ ] **Step 3: Rodar e confirmar que falham antes da Task 8 estar completa / passam depois dela**

Run: `cd mobile && npx jest src/__tests__/trajetoria.test.tsx`
Expected: com a Task 8 já implementada, PASS. (Se rodar esta task antes da 8 por engano, os testes falham porque `arrasto-MATA60` ainda não existe — é o gate normal de TDD; como este plano já sequenciou a Task 8 antes desta, a implementação já deve estar no lugar.)

Se `getByGestureTestId` não encontrar o handler (registro populado tarde demais em algum ambiente de CI), a alternativa documentada é testar a wiring sem o registry: renderizar `TrajetoriaTab` normalmente, pegar a instância do `Pressable`/`View` de `card-projetado-MATA60` via `screen.getByTestId`, e usar exatamente os testes de contexto isolado já escritos na Task 6 (`arrasto-semestre-context.test.tsx`) como a cobertura formal da lógica de decisão — os testes desta task then passam a ser tratados como smoke test de integração, best-effort. Não é um placeholder: é a segunda camada de cobertura já existente cobrindo a mesma lógica por um caminho diferente.

- [ ] **Step 4: Rodar a suíte inteira do mobile**

Run: `cd mobile && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd mobile && git add src/__tests__/trajetoria.test.tsx
git commit -m "test(trajetoria): cobre o arrasto de CardProjetado até o grid de semestres

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Verificação final ponta a ponta

**Files:** nenhum (só execução).

- [ ] **Step 1: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 2: Rodar a suíte inteira do mobile**

Run: `cd mobile && npm test`
Expected: PASS.

- [ ] **Step 3: Rodar o typecheck do mobile**

Run: `cd mobile && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Revisão manual no app (Expo Go ou simulador)**

Abrir a tela de Trajetória, segurar um card projetado, confirmar visualmente que o grid abre centralizado com fundo escurecido, arrastar até um quadradinho e soltar, confirmar que a matéria aparece no novo semestre após o reload da resposta do `putPlano`. Essa etapa cobre o que os testes automatizados deliberadamente não cobrem (posicionamento visual real na tela, sensação do gesto) — ver "Riscos" no spec.
