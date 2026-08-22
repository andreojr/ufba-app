# Vizinhos Curriculares Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o modal de grafo (`dagre`/SVG/pan-zoom) da árvore de dependências por uma tela de navegação em cascata — matéria atual + pré-requisitos diretos + o que ela desbloqueia diretamente, com o vocabulário visual de "linha do tempo" (pontinho + linha) já usado na Trajetória — e por uma situação real (cursada/em curso/liberada/bloqueada) calculada por um avaliador booleano de pré-requisito contra o histórico do aluno.

**Architecture:** Backend ganha um parser booleano pequeno (E/OU/parênteses) e um módulo puro que monta `{ atual, preRequisitos, desbloqueia }` com a situação de cada um, injetando o histórico já persistido do usuário (via JWT) ao lado da estrutura curricular já resolvida. Mobile troca a tela SVG por componentes RN normais (View/Pressable), removendo `dagre`, o patch do `graphlib` e o pan/zoom inteiros.

**Tech Stack:** NestJS + Prisma (backend, já existente), Expo/React Native (mobile, já existente). Nenhuma dependência nova; `dagre`/`@types/dagre`/`patch-package` saem do `mobile/package.json`.

**Spec:** [docs/superpowers/specs/2026-08-22-vizinhos-curriculares-design.md](../specs/2026-08-22-vizinhos-curriculares-design.md)

## Global Constraints

- Ignora fidelidade E/OU só na extração de códigos citados (`extrairCodigosCitados`, já existente) — usada pra achar vizinhos diretos. O avaliador booleano novo (`avaliarPreRequisito`) é o inverso: entende E/OU de verdade, usado só pra calcular situação (cursada/emCurso/liberada/bloqueada).
- Um código citado que não existe na grade ativa nunca vira nó — mas, na avaliação booleana, conta como não-satisfeito (não é descartado silenciosamente como era pro grafo).
- Só um nível de profundidade pra cada lado (pré-requisito direto, desbloqueio direto) — a navegação em cascata é o que dá a "profundidade", nunca um cálculo transitivo de uma vez.
- Situação: `cursada` (histórico tem `APR`), `emCurso` (histórico tem `MATR`), `liberada` (nem um nem outro, mas a expressão de pré-requisito avalia `true`), `bloqueada` (nem um nem outro, expressão avalia `false`).
- Sem histórico persistido pro usuário: tudo vira `bloqueada` por padrão (nunca inventa cursada/liberada sem dado real).
- Backend busca o histórico do usuário autenticado via JWT (`@CurrentUser()`/`RequestUser.userId`) — o mobile não manda histórico na requisição.
- `curso` continua vindo como query param do mobile (mesma decisão já registrada no catálogo de currículo) — não resolve `User.curso` no servidor.

---

## File Structure

**Backend:**
- Modify: `backend/src/curriculo/arvore-dependencias.ts` — remove `construirArvoreDependencias`/`NoArvore`/`ArestaArvore`/`ArvoreDependencias`/`ComponenteParaArvore`, mantém só `extrairCodigosCitados`.
- Modify: `backend/src/curriculo/arvore-dependencias.spec.ts` — remove o describe de `construirArvoreDependencias`, mantém o de `extrairCodigosCitados`.
- Create: `backend/src/curriculo/avaliador-prerequisito.ts` — parser booleano (E/OU/parênteses) + avaliador.
- Create: `backend/src/curriculo/avaliador-prerequisito.spec.ts`
- Create: `backend/src/curriculo/vizinhos-curriculares.ts` — monta `{ atual, preRequisitos, desbloqueia }` com situação calculada.
- Create: `backend/src/curriculo/vizinhos-curriculares.spec.ts`
- Modify: `backend/src/curriculo/curriculo.service.ts` — remove `arvoreDependencias`/`arvoreDependenciasPorNomeUsuario`/`montarArvoreOuFalhar`, adiciona `vizinhosCurriculares`/`vizinhosCurricularesPorNomeUsuario`, injeta `HistoricoRepository`.
- Modify: `backend/src/curriculo/curriculo.service.spec.ts` — troca o describe de `arvoreDependencias` por um de `vizinhosCurriculares`.
- Modify: `backend/src/curriculo/curriculo.module.ts` — injeta `HISTORICO_REPOSITORY` (já exportado por `DatabaseModule`, já importado por este módulo).
- Modify: `backend/src/curriculo/curriculo.controller.ts` — troca as rotas `arvore-dependencias` por `vizinhos`, usando `@CurrentUser()`.
- Modify: `backend/src/curriculo/curriculo.controller.spec.ts` — mesma troca.

**Mobile:**
- Modify: `mobile/src/lib/types.ts` — remove `NoArvoreDependencias`/`ArestaArvoreDependencias`/`ArvoreDependenciasResponse`, adiciona `SituacaoVizinho`/`VizinhoCurricular`/`VizinhosCurricularesResponse`.
- Modify: `mobile/src/lib/api.ts` — remove `getArvoreDependencias`, adiciona `getVizinhosCurriculares`.
- Modify: `mobile/src/lib/api.test.ts` — mesma troca.
- Modify: `mobile/src/components/AppIcon.tsx` — adiciona `IconLockKeyOpen` (`lock-open-outline`) ao mapa de ícones, pro estado "liberada".
- Rewrite: `mobile/src/app/arvore-dependencias.tsx` — nova tela "linha do tempo" (mesmo arquivo/rota de antes, conteúdo totalmente novo).
- Rewrite: `mobile/src/__tests__/arvore-dependencias.test.tsx`
- Delete: `mobile/src/lib/arvore-dependencias-layout.ts` + `mobile/src/lib/arvore-dependencias-layout.test.ts`
- Delete: `mobile/src/lib/pan-zoom.ts` + `mobile/src/lib/pan-zoom.test.ts`
- Delete: `mobile/patches/graphlib+2.1.8.patch`
- Modify: `mobile/package.json` — remove `dagre`, `@types/dagre`, `patch-package`, o script `postinstall`.
- Modify: `mobile/src/screens/TrajetoriaTab.tsx` — renomeia `onAbrirArvore` → `onAbrirVizinhos` (mesma wiring, mesmo destino).
- Modify: `mobile/src/__tests__/trajetoria.test.tsx` — mesma renomeação no teste.

> Nota pro executor: `mobile/src/screens/TrajetoriaTab.tsx` é o caminho atual em disco no momento em que este plano foi escrito (renomeado de `mobile/src/app/(tabs)/trajetoria.tsx` por uma sessão concorrente, ainda não commitado). Se o arquivo já não existir mais nesse caminho quando você for executar a Task 8, procure por `onAbrirArvore` no repositório (`grep -rn "onAbrirArvore" mobile/src`) pra achar o caminho real antes de editar.

---

### Task 1: Avaliador booleano de pré-requisito

**Files:**
- Create: `backend/src/curriculo/avaliador-prerequisito.ts`
- Test: `backend/src/curriculo/avaliador-prerequisito.spec.ts`

**Interfaces:**
- Produces: `avaliarPreRequisito(texto: string | null, aprovados: ReadonlySet<string>): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/avaliador-prerequisito.spec.ts
import { avaliarPreRequisito } from './avaliador-prerequisito';

describe('avaliarPreRequisito', () => {
  it('sem pré-requisito, avalia true trivialmente', () => {
    expect(avaliarPreRequisito(null, new Set())).toBe(true);
    expect(avaliarPreRequisito('', new Set())).toBe(true);
  });

  it('um único código: true se aprovado, false se não', () => {
    expect(avaliarPreRequisito('MATA02', new Set(['MATA02']))).toBe(true);
    expect(avaliarPreRequisito('MATA02', new Set())).toBe(false);
  });

  it('E: só true se AMBOS aprovados', () => {
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set(['FISD36', 'FISD42']))).toBe(true);
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set(['FISD36']))).toBe(false);
    expect(avaliarPreRequisito('FISD36 E FISD42', new Set())).toBe(false);
  });

  it('OU: true se PELO MENOS UM aprovado', () => {
    expect(avaliarPreRequisito('FISD36 OU FISD42', new Set(['FISD42']))).toBe(true);
    expect(avaliarPreRequisito('FISD36 OU FISD42', new Set())).toBe(false);
  });

  it('parênteses + E/OU combinados: "(A E B) OU (C)"', () => {
    const texto = '(FISD36 E FISD42) OU (ENGJ18)';
    // Só ENGJ18 aprovado — o ramo OU alternativo basta.
    expect(avaliarPreRequisito(texto, new Set(['ENGJ18']))).toBe(true);
    // Só FISD36 aprovado — falta FISD42 no ramo E, e o ramo OU não foi
    // satisfeito por nenhum dos dois lados.
    expect(avaliarPreRequisito(texto, new Set(['FISD36']))).toBe(false);
    // Os dois do ramo E aprovados — não precisa do ramo OU.
    expect(avaliarPreRequisito(texto, new Set(['FISD36', 'FISD42']))).toBe(true);
  });

  it('parênteses aninhados: "((A OU B) E C)"', () => {
    const texto = '((MATA02 OU MATA03) E FISD36)';
    expect(avaliarPreRequisito(texto, new Set(['MATA02', 'FISD36']))).toBe(true);
    expect(avaliarPreRequisito(texto, new Set(['MATA03', 'FISD36']))).toBe(true);
    expect(avaliarPreRequisito(texto, new Set(['MATA02']))).toBe(false);
    expect(avaliarPreRequisito(texto, new Set(['FISD36']))).toBe(false);
  });

  it('código citado que o aluno nunca cursou conta como não-satisfeito, mesmo que não exista na grade ativa', () => {
    // Sem filtro contra a grade aqui (isso é responsabilidade de quem monta
    // a lista de vizinhos exibidos, não do avaliador) — o avaliador só olha
    // se o código está no conjunto de aprovados.
    expect(avaliarPreRequisito('CODIGOFANTASMA99', new Set())).toBe(false);
  });

  it('texto malformado (parêntese não fechado) não lança — avalia false defensivamente', () => {
    expect(avaliarPreRequisito('(MATA02 E FISD36', new Set(['MATA02', 'FISD36']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest avaliador-prerequisito -v`
Expected: FAIL — `Cannot find module './avaliador-prerequisito'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/avaliador-prerequisito.ts

// Mesmo padrão de código de disciplina usado em arvore-dependencias.ts —
// letras maiúsculas + dígitos, com uma letra final opcional (ex: ENG295A).
const CODIGO_PATTERN = /[A-Z]{1,6}\d{1,4}[A-Z]?/g;

type Token =
  | { tipo: 'ABRE' }
  | { tipo: 'FECHA' }
  | { tipo: 'E' }
  | { tipo: 'OU' }
  | { tipo: 'CODIGO'; codigo: string };

// "(" e ")" são tokens próprios mesmo colados a um código ("(FISD36") — por
// isso o parêntese entra na mesma regex de tokenização, antes do código.
const TOKEN_PATTERN = /\(|\)|\bOU\b|\bE\b|[A-Z]{1,6}\d{1,4}[A-Z]?/g;

function tokenizar(texto: string): Token[] {
  const brutos = texto.match(TOKEN_PATTERN) ?? [];
  return brutos.map((bruto): Token => {
    if (bruto === '(') return { tipo: 'ABRE' };
    if (bruto === ')') return { tipo: 'FECHA' };
    if (bruto === 'OU') return { tipo: 'OU' };
    if (bruto === 'E') return { tipo: 'E' };
    return { tipo: 'CODIGO', codigo: bruto };
  });
}

type Expressao =
  | { tipo: 'CODIGO'; codigo: string }
  | { tipo: 'E'; esquerda: Expressao; direita: Expressao }
  | { tipo: 'OU'; esquerda: Expressao; direita: Expressao };

/**
 * Recursivo-descendente simples: `expr := termo (OU termo)*`,
 * `termo := fator (E fator)*`, `fator := CODIGO | '(' expr ')'` — E tem
 * precedência sobre OU, igual álgebra booleana comum.
 */
class ParserPreRequisito {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parsear(): Expressao {
    const expr = this.parsearOu();
    if (this.pos !== this.tokens.length) {
      throw new Error('Expressão de pré-requisito malformada: tokens sobrando ao final');
    }
    return expr;
  }

  private parsearOu(): Expressao {
    let esquerda = this.parsearE();
    while (this.atual()?.tipo === 'OU') {
      this.pos++;
      const direita = this.parsearE();
      esquerda = { tipo: 'OU', esquerda, direita };
    }
    return esquerda;
  }

  private parsearE(): Expressao {
    let esquerda = this.parsearFator();
    while (this.atual()?.tipo === 'E') {
      this.pos++;
      const direita = this.parsearFator();
      esquerda = { tipo: 'E', esquerda, direita };
    }
    return esquerda;
  }

  private parsearFator(): Expressao {
    const token = this.atual();
    if (!token) {
      throw new Error('Expressão de pré-requisito malformada: esperava código ou "("');
    }
    if (token.tipo === 'ABRE') {
      this.pos++;
      const expr = this.parsearOu();
      if (this.atual()?.tipo !== 'FECHA') {
        throw new Error('Expressão de pré-requisito malformada: parêntese não fechado');
      }
      this.pos++;
      return expr;
    }
    if (token.tipo === 'CODIGO') {
      this.pos++;
      return { tipo: 'CODIGO', codigo: token.codigo };
    }
    throw new Error(`Expressão de pré-requisito malformada: token inesperado "${token.tipo}"`);
  }

  private atual(): Token | undefined {
    return this.tokens[this.pos];
  }
}

function avaliarExpressao(expr: Expressao, aprovados: ReadonlySet<string>): boolean {
  if (expr.tipo === 'CODIGO') {
    return aprovados.has(expr.codigo);
  }
  if (expr.tipo === 'E') {
    return avaliarExpressao(expr.esquerda, aprovados) && avaliarExpressao(expr.direita, aprovados);
  }
  return avaliarExpressao(expr.esquerda, aprovados) || avaliarExpressao(expr.direita, aprovados);
}

/**
 * Avalia se `texto` (o `preRequisito` cru de um componente) está satisfeito
 * pelo conjunto de códigos que o aluno já tem aprovados (`APR` no
 * histórico). Sem pré-requisito, avalia `true` trivialmente. Um código
 * citado que o aluno nunca aprovou conta como não-satisfeito — mesmo que
 * ele não exista na grade ativa (filtrar isso é responsabilidade de quem
 * monta a lista de vizinhos exibidos, não deste avaliador).
 *
 * Um texto malformado (nunca observado num currículo real, mas o parser é
 * novo e não vale confiar 100% em texto raspado) avalia `false`
 * defensivamente — nunca mostrar "liberada" para uma satisfação que não
 * deu pra verificar de verdade.
 */
export function avaliarPreRequisito(
  texto: string | null,
  aprovados: ReadonlySet<string>,
): boolean {
  if (!texto) {
    return true;
  }
  const tokens = tokenizar(texto);
  if (tokens.length === 0) {
    return true;
  }
  try {
    const expr = new ParserPreRequisito(tokens).parsear();
    return avaliarExpressao(expr, aprovados);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest avaliador-prerequisito -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/avaliador-prerequisito.ts backend/src/curriculo/avaliador-prerequisito.spec.ts
git commit -m "feat(backend): avaliador booleano de pré-requisito (E/OU/parênteses)"
```

---

### Task 2: Vizinhos curriculares (pré-requisitos diretos + quem desbloqueia)

**Files:**
- Create: `backend/src/curriculo/vizinhos-curriculares.ts`
- Test: `backend/src/curriculo/vizinhos-curriculares.spec.ts`

**Interfaces:**
- Consumes: `extrairCodigosCitados` (de `backend/src/curriculo/arvore-dependencias.ts`, já existente); `avaliarPreRequisito` (Task 1).
- Produces:
  - `type SituacaoVizinho = 'cursada' | 'emCurso' | 'liberada' | 'bloqueada'`
  - `interface ComponenteParaVizinhos { codigo: string; nome: string; preRequisito: string | null }`
  - `interface HistoricoParaVizinhos { aprovados: ReadonlySet<string>; matriculados: ReadonlySet<string> }`
  - `interface VizinhoCurricular { codigo: string; nome: string; situacao: SituacaoVizinho }`
  - `interface VizinhosCurriculares { atual: VizinhoCurricular; preRequisitos: VizinhoCurricular[]; desbloqueia: VizinhoCurricular[] }`
  - `montarVizinhos(componentes: ComponenteParaVizinhos[], codigoRaiz: string, historico: HistoricoParaVizinhos): VizinhosCurriculares | null` — `null` quando `codigoRaiz` não existe em `componentes`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/vizinhos-curriculares.spec.ts
import { montarVizinhos, type ComponenteParaVizinhos, type HistoricoParaVizinhos } from './vizinhos-curriculares';

describe('montarVizinhos', () => {
  const componentes: ComponenteParaVizinhos[] = [
    { codigo: 'MATA02', nome: 'Cálculo A', preRequisito: null },
    { codigo: 'FISB08', nome: 'Física B', preRequisito: null },
    { codigo: 'MATA03', nome: 'Cálculo B', preRequisito: 'MATA02' },
    { codigo: 'MATA04', nome: 'Cálculo C', preRequisito: 'MATA03' },
    // Cita um código (ENGJ18) que não existe na grade — deve ser ignorado
    // ao montar o bloco de pré-requisitos exibidos (mas ainda conta como
    // não-satisfeito na avaliação de situação, já coberto pelos testes do
    // avaliador em avaliador-prerequisito.spec.ts).
    { codigo: 'ENGC30', nome: 'Mecânica dos Sólidos', preRequisito: '(MATA03 E FISB08) OU (ENGJ18)' },
  ];

  function historico(aprovados: string[] = [], matriculados: string[] = []): HistoricoParaVizinhos {
    return { aprovados: new Set(aprovados), matriculados: new Set(matriculados) };
  }

  it('monta pré-requisitos diretos e quem desbloqueia diretamente, com situação de cada um', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA03', historico(['MATA02']));
    expect(vizinhos).toEqual({
      atual: { codigo: 'MATA03', nome: 'Cálculo B', situacao: 'liberada' },
      preRequisitos: [{ codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' }],
      desbloqueia: [{ codigo: 'MATA04', nome: 'Cálculo C', situacao: 'bloqueada' }],
    });
  });

  it('cursada (APR) tem prioridade sobre o cálculo de liberada/bloqueada', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA02', historico(['MATA02']));
    expect(vizinhos?.atual).toEqual({ codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' });
  });

  it('emCurso (MATR) tem prioridade sobre liberada/bloqueada, mas não sobre cursada', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA03', historico(['MATA02'], ['MATA03']));
    expect(vizinhos?.atual).toEqual({ codigo: 'MATA03', nome: 'Cálculo B', situacao: 'emCurso' });
  });

  it('código citado ausente da grade não aparece na lista de pré-requisitos exibidos', () => {
    const vizinhos = montarVizinhos(componentes, 'ENGC30', historico(['MATA02', 'MATA03', 'FISB08']));
    expect(vizinhos?.preRequisitos.map((v) => v.codigo).sort()).toEqual(['FISB08', 'MATA03']);
  });

  it('matéria sem pré-requisito (ex: período 1) devolve preRequisitos vazio', () => {
    const vizinhos = montarVizinhos(componentes, 'MATA02', historico());
    expect(vizinhos?.preRequisitos).toEqual([]);
  });

  it('matéria que nada desbloqueia (ex: última do curso) devolve desbloqueia vazio', () => {
    const vizinhos = montarVizinhos(componentes, 'ENGC30', historico());
    expect(vizinhos?.desbloqueia).toEqual([]);
  });

  it('código raiz que não existe na grade devolve null', () => {
    expect(montarVizinhos(componentes, 'XXXX00', historico())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest vizinhos-curriculares -v`
Expected: FAIL — `Cannot find module './vizinhos-curriculares'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/vizinhos-curriculares.ts
import { extrairCodigosCitados } from './arvore-dependencias';
import { avaliarPreRequisito } from './avaliador-prerequisito';

export type SituacaoVizinho = 'cursada' | 'emCurso' | 'liberada' | 'bloqueada';

export interface ComponenteParaVizinhos {
  codigo: string;
  nome: string;
  preRequisito: string | null;
}

export interface HistoricoParaVizinhos {
  aprovados: ReadonlySet<string>;
  matriculados: ReadonlySet<string>;
}

export interface VizinhoCurricular {
  codigo: string;
  nome: string;
  situacao: SituacaoVizinho;
}

export interface VizinhosCurriculares {
  atual: VizinhoCurricular;
  preRequisitos: VizinhoCurricular[];
  desbloqueia: VizinhoCurricular[];
}

function calcularSituacao(
  componente: ComponenteParaVizinhos,
  historico: HistoricoParaVizinhos,
): SituacaoVizinho {
  if (historico.aprovados.has(componente.codigo)) {
    return 'cursada';
  }
  if (historico.matriculados.has(componente.codigo)) {
    return 'emCurso';
  }
  return avaliarPreRequisito(componente.preRequisito, historico.aprovados)
    ? 'liberada'
    : 'bloqueada';
}

function paraVizinho(
  componente: ComponenteParaVizinhos,
  historico: HistoricoParaVizinhos,
): VizinhoCurricular {
  return {
    codigo: componente.codigo,
    nome: componente.nome,
    situacao: calcularSituacao(componente, historico),
  };
}

/**
 * Monta a matéria atual, seus pré-requisitos DIRETOS (um nível, não
 * transitivo) e o que ela desbloqueia DIRETAMENTE — cada um com a situação
 * do aluno pra aquela matéria. `null` quando `codigoRaiz` não existe em
 * `componentes` (a estrutura curricular ativa) — quem chama decide como
 * comunicar isso (404, tipicamente).
 */
export function montarVizinhos(
  componentes: ComponenteParaVizinhos[],
  codigoRaiz: string,
  historico: HistoricoParaVizinhos,
): VizinhosCurriculares | null {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  const raiz = porCodigo.get(codigoRaiz);
  if (!raiz) {
    return null;
  }

  const codigosPreRequisito = extrairCodigosCitados(raiz.preRequisito).filter((codigo) =>
    porCodigo.has(codigo),
  );
  const preRequisitos = codigosPreRequisito.map((codigo) =>
    paraVizinho(porCodigo.get(codigo)!, historico),
  );

  const desbloqueia = componentes
    .filter((c) => extrairCodigosCitados(c.preRequisito).includes(codigoRaiz))
    .map((c) => paraVizinho(c, historico));

  return {
    atual: paraVizinho(raiz, historico),
    preRequisitos,
    desbloqueia,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest vizinhos-curriculares -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/vizinhos-curriculares.ts backend/src/curriculo/vizinhos-curriculares.spec.ts
git commit -m "feat(backend): monta vizinhos curriculares (pré-requisitos diretos + desbloqueia) com situação"
```

---

### Task 3: `CurriculoService` — trocar o grafo pelos vizinhos, injetar histórico

**Files:**
- Modify: `backend/src/curriculo/curriculo.service.ts`
- Modify: `backend/src/curriculo/curriculo.service.spec.ts`
- Modify: `backend/src/curriculo/curriculo.module.ts`
- Modify: `backend/src/curriculo/arvore-dependencias.ts`
- Modify: `backend/src/curriculo/arvore-dependencias.spec.ts`

**Interfaces:**
- Consumes: `montarVizinhos`, `VizinhosCurriculares`, `HistoricoParaVizinhos` (Task 2); `HistoricoRepository`/`TrajetoriaSalva` de `backend/src/sigaa-engine/historico.repository.ts` (já existente); `HISTORICO_REPOSITORY` de `backend/src/db/tokens.ts` (já existente, já exportado por `DatabaseModule`, que `CurriculoModule` já importa).
- Produces:
  - `CurriculoService.vizinhosCurriculares(cursoId: string, codigo: string, userId: string): Promise<VizinhosCurriculares>`
  - `CurriculoService.vizinhosCurricularesPorNomeUsuario(nomeCurso: string, codigo: string, userId: string): Promise<VizinhosCurriculares>`
  - `CurriculoService`'s constructor ganha um 4º parâmetro opcional `historicoRepository: HistoricoRepository`, com um default "sem histórico" — os 14 testes já existentes de `listarCursos`/`resolverCurso`/`resolverPorNomeUsuario` continuam passando sem tocar (não exercitam vizinhos, então o default é inofensivo).

- [ ] **Step 1: Write the failing test**

Primeiro, remova o describe `arvoreDependencias / arvoreDependenciasPorNomeUsuario` inteiro (linhas 457–568 no arquivo atual) de `curriculo.service.spec.ts` e troque pelo bloco abaixo. Ajuste também o import do topo do arquivo (troque `ComponenteDesconhecidoError` — que continua existindo — nada a remover daí; só adicione os imports novos listados).

```ts
// backend/src/curriculo/curriculo.service.spec.ts
// Adicionar aos imports do topo do arquivo:
import type { HistoricoRepository, TrajetoriaSalva } from '../sigaa-engine/historico.repository';
import type { Historico } from '../sigaa-engine/parsers/historico';

// Substituir o describe('arvoreDependencias / arvoreDependenciasPorNomeUsuario', ...)
// inteiro por este:
describe('vizinhosCurriculares / vizinhosCurricularesPorNomeUsuario', () => {
  const estruturaSalva = {
    idSigaa: 'e1',
    codigo: 'G20251',
    anoPeriodoImplementacao: '2025.1',
    cargaHorariaTotal: 3200,
    cargaHorariaObrigatoria: 2400,
    cargaHorariaOptativaMinima: 400,
    cargaHorariaComplementarMinima: 200,
    prazoMinimoSemestres: 8,
    prazoMedioSemestres: 10,
    prazoMaximoSemestres: 14,
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    staleAfter: new Date('2027-01-01T00:00:00Z'),
    componentes: [
      {
        idSigaa: 'c1',
        codigo: 'MATA02',
        nome: 'Cálculo A',
        cargaHoraria: 68,
        natureza: 'OBRIGATORIA' as const,
        periodo: 1,
        unidadeResponsavel: null,
        preRequisito: null,
        coRequisito: null,
        equivalencias: null,
      },
      {
        idSigaa: 'c2',
        codigo: 'MATA03',
        nome: 'Cálculo B',
        cargaHoraria: 68,
        natureza: 'OBRIGATORIA' as const,
        periodo: 2,
        unidadeResponsavel: null,
        preRequisito: 'MATA02',
        coRequisito: null,
        equivalencias: null,
      },
    ],
  };

  function historicoFalso(cursados: Historico['cursados']): Historico {
    return {
      emitidoEm: '2026-01-01',
      curriculo: 'G20251 - 2025.1',
      nomeCurso: 'ENGENHARIA DA COMPUTAÇÃO/EPOLI - SALVADOR',
      periodoLetivoAtual: 2,
      prazoConclusaoPadrao: '2029.1',
      prazoConclusaoMaximo: '2032.1',
      indices: { cr: null, iap: null },
      cursados,
      pendentesObrigatorios: [],
      cargaHoraria: {
        obrigatorias: { exigida: 3150, integralizada: 0, pendente: 3150 },
        optativas: { exigida: 360, integralizada: 0, pendente: 360 },
        complementares: { exigida: 100, integralizada: 0, pendente: 100 },
        total: { exigida: 3610, integralizada: 0, pendente: 3610 },
      },
      equivalencias: [],
      observacoes: [],
    };
  }

  function fakeHistoricoRepository(
    overrides: Partial<HistoricoRepository> = {},
  ): jest.Mocked<HistoricoRepository> {
    return {
      buscar: jest.fn().mockResolvedValue(null),
      salvar: jest.fn().mockResolvedValue(undefined),
      reconciliarPlano: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('vizinhosCurriculares busca a estrutura já resolvida e o histórico do usuário, e monta os vizinhos', async () => {
    const repository = fakeRepository({
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    const salva: TrajetoriaSalva = {
      historico: historicoFalso([
        { semestre: '2025.1', natureza: 'OB', codigo: 'MATA02', nome: 'Cálculo A', cargaHoraria: 68, nota: 8, situacao: 'APR', docente: null },
      ]),
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
      plano: [],
    };
    const historicoRepository = fakeHistoricoRepository({
      buscar: jest.fn().mockResolvedValue(salva),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora, historicoRepository);
    const vizinhos = await service.vizinhosCurriculares('curso-1', 'MATA03', 'user-1');
    expect(vizinhos.atual).toEqual({ codigo: 'MATA03', nome: 'Cálculo B', situacao: 'liberada' });
    expect(vizinhos.preRequisitos).toEqual([
      { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
    ]);
    expect(historicoRepository.buscar).toHaveBeenCalledWith('user-1');
  });

  it('vizinhosCurricularesPorNomeUsuario resolve o curso pelo nome e monta os vizinhos', async () => {
    const repository = fakeRepository({
      buscarCursos: jest.fn().mockResolvedValue([
        { idSigaa: 'curso-1', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
      ]),
      buscarDiretorioAtualizadoEm: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    const historicoRepository = fakeHistoricoRepository();
    const service = new CurriculoService(fakeHttp({}), repository, agora, historicoRepository);
    const vizinhos = await service.vizinhosCurricularesPorNomeUsuario(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
      'MATA02',
      'user-1',
    );
    expect(vizinhos.atual.codigo).toBe('MATA02');
  });

  it('sem histórico persistido (usuário nunca sincronizou), tudo vira bloqueada por padrão — exceto quem não tem pré-requisito, que vira liberada', async () => {
    const repository = fakeRepository({
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    // fakeHistoricoRepository() sem overrides já devolve buscar() -> null.
    const service = new CurriculoService(fakeHttp({}), repository, agora, fakeHistoricoRepository());
    const vizinhos = await service.vizinhosCurriculares('curso-1', 'MATA03', 'user-1');
    expect(vizinhos.atual.situacao).toBe('bloqueada');
    expect(vizinhos.preRequisitos).toEqual([
      { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'liberada' },
    ]);
  });

  it('vizinhosCurriculares lança ComponenteDesconhecidoError quando o código não está na estrutura ativa', async () => {
    const repository = fakeRepository({
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    const service = new CurriculoService(fakeHttp({}), repository, agora, fakeHistoricoRepository());
    await expect(
      service.vizinhosCurriculares('curso-1', 'NAOEXISTE01', 'user-1'),
    ).rejects.toThrow(ComponenteDesconhecidoError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.service -v`
Expected: FAIL — `service.vizinhosCurriculares is not a function`

- [ ] **Step 3: Write minimal implementation**

Primeiro, trim `arvore-dependencias.ts`: remova `construirArvoreDependencias` e as interfaces `NoArvore`/`ArestaArvore`/`ArvoreDependencias`/`ComponenteParaArvore`, mantendo só `extrairCodigosCitados` (e o `CODIGO_PATTERN`/comentário acima dele). O arquivo final deve ter só isto:

```ts
// backend/src/curriculo/arvore-dependencias.ts (arquivo inteiro, depois do trim)

// Case: "(FISD36 E FISD42) OU (ENGJ18)" — captura o código de disciplina bruto
// (letras maiúsculas seguidas de dígitos, com uma letra final opcional para
// variantes de equivalência como "ENG295A"), ignorando por completo a
// estrutura lógica E/OU/parênteses ao redor. Usado pra achar vizinhos
// diretos (quem cita quem) em vizinhos-curriculares.ts — a fidelidade E/OU
// fica com o avaliador booleano em avaliador-prerequisito.ts.
// Aceita também códigos muito curtos (ex: A1, B1) para testes defensivos de ciclos.
const CODIGO_PATTERN = /[A-Z]{1,6}\d{1,4}[A-Z]?/g;

export function extrairCodigosCitados(texto: string | null): string[] {
  if (!texto) {
    return [];
  }
  const encontrados = texto.match(CODIGO_PATTERN) ?? [];
  return [...new Set(encontrados)];
}
```

Em `arvore-dependencias.spec.ts`, remova o `describe('construirArvoreDependencias', ...)` inteiro e o import de `construirArvoreDependencias`/`ComponenteParaArvore` — o arquivo deve sobrar só com o `describe('extrairCodigosCitados', ...)` e seu import (`import { extrairCodigosCitados } from './arvore-dependencias';`).

Agora, em `curriculo.service.ts`:

```ts
// backend/src/curriculo/curriculo.service.ts
// Troca o import de arvore-dependencias:
import type { HistoricoRepository } from '../sigaa-engine/historico.repository';
import {
  montarVizinhos,
  type HistoricoParaVizinhos,
  type VizinhosCurriculares,
} from './vizinhos-curriculares';

// (remove o import de construirArvoreDependencias/ArvoreDependencias — não
// há mais nenhum outro uso de arvore-dependencias.ts neste arquivo)

// Adicionar antes da classe CurriculoService:

// Default seguro pro 4º parâmetro do construtor — "sem histórico
// persistido" é uma resposta válida (vira tudo bloqueada por padrão em
// vizinhosCurriculares), então os testes de listarCursos/resolverCurso/
// resolverPorNomeUsuario que não passam um 4º argumento continuam
// funcionando sem tocar. Produção nunca usa este default: curriculo.module.ts
// sempre injeta o HistoricoRepository real.
const HISTORICO_REPOSITORY_AUSENTE: HistoricoRepository = {
  buscar: async () => null,
  salvar: async () => undefined,
  reconciliarPlano: async () => undefined,
};

// Troca a assinatura do construtor da classe (mantém http/repository/agora
// nas mesmas posições — só acrescenta o 4º parâmetro no final):
  constructor(
    private readonly http: SigaaHttpClient,
    private readonly repository: CurriculoRepository,
    private readonly agora: () => Date = () => new Date(),
    private readonly historicoRepository: HistoricoRepository = HISTORICO_REPOSITORY_AUSENTE,
  ) {}

// Substitui os métodos arvoreDependencias/arvoreDependenciasPorNomeUsuario/
// montarArvoreOuFalhar (ao final da classe) por:

  /**
   * Vizinhos diretos (pré-requisitos + quem desbloqueia) de `codigo` dentro
   * da estrutura curricular já resolvida/persistida de `cursoId`, com a
   * situação do usuário `userId` pra cada um — não dispara scraping ao vivo
   * (mesma regra de cache de `resolverCurso`).
   */
  async vizinhosCurriculares(
    cursoId: string,
    codigo: string,
    userId: string,
  ): Promise<VizinhosCurriculares> {
    const estrutura = await this.resolverCurso(cursoId);
    const historico = await this.historicoParaUsuario(userId);
    return this.montarVizinhosOuFalhar(estrutura.componentes, codigo, cursoId, historico);
  }

  /** Mesma conveniência de resolverPorNomeUsuario, aplicada aos vizinhos. */
  async vizinhosCurricularesPorNomeUsuario(
    nomeCurso: string,
    codigo: string,
    userId: string,
  ): Promise<VizinhosCurriculares> {
    const estrutura = await this.resolverPorNomeUsuario(nomeCurso);
    const historico = await this.historicoParaUsuario(userId);
    return this.montarVizinhosOuFalhar(estrutura.componentes, codigo, nomeCurso, historico);
  }

  /**
   * Sem histórico persistido pro usuário (nunca sincronizou a Trajetória):
   * devolve os dois conjuntos vazios — vizinhos-curriculares.ts trata isso
   * como "tudo bloqueada por padrão", nunca inventa cursada/liberada sem
   * dado real.
   */
  private async historicoParaUsuario(userId: string): Promise<HistoricoParaVizinhos> {
    const salva = await this.historicoRepository.buscar(userId);
    if (!salva) {
      return { aprovados: new Set(), matriculados: new Set() };
    }
    const aprovados = new Set(
      salva.historico.cursados.filter((c) => c.situacao === 'APR').map((c) => c.codigo),
    );
    const matriculados = new Set(
      salva.historico.cursados.filter((c) => c.situacao === 'MATR').map((c) => c.codigo),
    );
    return { aprovados, matriculados };
  }

  private montarVizinhosOuFalhar(
    componentes: Parameters<typeof montarVizinhos>[0],
    codigo: string,
    identificadorCurso: string,
    historico: HistoricoParaVizinhos,
  ): VizinhosCurriculares {
    const vizinhos = montarVizinhos(componentes, codigo, historico);
    if (!vizinhos) {
      throw new ComponenteDesconhecidoError(codigo, identificadorCurso);
    }
    return vizinhos;
  }
```

A classe `ComponenteDesconhecidoError` (e `CursoDesconhecidoError`/`SemEstruturaAtivaError`) já existem no arquivo e não mudam — só o comentário acima de `ComponenteDesconhecidoError` cita `construirArvoreDependencias`; atualize pra citar `montarVizinhos`:

```ts
export class ComponenteDesconhecidoError extends Error {
  constructor(codigo: string, cursoId: string) {
    super(
      `Component ${codigo} is not in course ${cursoId}'s active curriculum structure`,
    );
    // Same convention as CursoDesconhecidoError: SigaaExceptionFilter maps
    // status codes off `exception.name`. This distinguishes "root código not
    // found in the active grade" (montarVizinhos devolve null) do caso
    // genuinamente vazio de dependentes/pré-requisitos, que ainda devolve um
    // VizinhosCurriculares válido (com listas vazias).
    this.name = 'ComponenteDesconhecidoError';
  }
}
```

Por fim, `curriculo.module.ts` — injeta `HISTORICO_REPOSITORY` (já exportado por `DatabaseModule`, que este módulo já importa):

```ts
// backend/src/curriculo/curriculo.module.ts
import { Module } from '@nestjs/common';
import { createSigaaHttpClient } from '../sigaa-engine/http-client';
import { DatabaseModule } from '../db/database.module';
import { CURRICULO_REPOSITORY, HISTORICO_REPOSITORY } from '../db/tokens';
import type { CurriculoRepository } from './curriculo.repository';
import type { HistoricoRepository } from '../sigaa-engine/historico.repository';
import { CurriculoController } from './curriculo.controller';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

@Module({
  imports: [DatabaseModule],
  controllers: [CurriculoController],
  providers: [
    {
      provide: CURRICULO_SERVICE,
      inject: [CURRICULO_REPOSITORY, HISTORICO_REPOSITORY],
      useFactory: (
        repository: CurriculoRepository,
        historicoRepository: HistoricoRepository,
      ) =>
        new CurriculoService(
          createSigaaHttpClient(),
          repository,
          () => new Date(),
          historicoRepository,
        ),
    },
  ],
  exports: [CURRICULO_SERVICE],
})
export class CurriculoModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.service arvore-dependencias vizinhos-curriculares -v`
Expected: PASS (todos os describes, incluindo os 14 testes pré-existentes de listarCursos/resolverCurso/resolverPorNomeUsuario que não mudaram)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/curriculo.service.ts backend/src/curriculo/curriculo.service.spec.ts backend/src/curriculo/curriculo.module.ts backend/src/curriculo/arvore-dependencias.ts backend/src/curriculo/arvore-dependencias.spec.ts
git commit -m "feat(backend): CurriculoService monta vizinhos curriculares com histórico do usuário"
```

---

### Task 4: Rotas do controller — troca `arvore-dependencias` por `vizinhos`

**Files:**
- Modify: `backend/src/curriculo/curriculo.controller.ts`
- Modify: `backend/src/curriculo/curriculo.controller.spec.ts`

**Interfaces:**
- Consumes: `CurriculoService.vizinhosCurriculares`/`vizinhosCurricularesPorNomeUsuario` (Task 3); `CurrentUser` de `backend/src/auth/current-user.decorator.ts` (já existente); `RequestUser` de `backend/src/auth/jwt.strategy.ts` (já existente).
- Produces:
  - `GET /curriculo/cursos/:cursoId/componentes/:codigo/vizinhos`
  - `GET /curriculo/meu-curso/componentes/:codigo/vizinhos?curso=`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/curriculo.controller.spec.ts
// Ajustar o mock do service (perto do topo do describe) para trocar os
// métodos antigos pelos novos:
  const service: jest.Mocked<
    Pick<
      CurriculoService,
      | 'listarCursos'
      | 'resolverCurso'
      | 'resolverPorNomeUsuario'
      | 'vizinhosCurriculares'
      | 'vizinhosCurricularesPorNomeUsuario'
    >
  > = {
    listarCursos: jest.fn(),
    resolverCurso: jest.fn(),
    resolverPorNomeUsuario: jest.fn(),
    vizinhosCurriculares: jest.fn(),
    vizinhosCurricularesPorNomeUsuario: jest.fn(),
  };

// Substituir os dois últimos testes (das rotas arvore-dependencias) por:
  it('GET /curriculo/cursos/:cursoId/componentes/:codigo/vizinhos devolve os vizinhos', async () => {
    service.vizinhosCurriculares.mockResolvedValue({
      atual: { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
      preRequisitos: [],
      desbloqueia: [],
    });
    const res = await request(app.getHttpServer()).get(
      '/curriculo/cursos/1/componentes/MATA02/vizinhos',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      atual: { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
      preRequisitos: [],
      desbloqueia: [],
    });
    expect(service.vizinhosCurriculares).toHaveBeenCalledWith('1', 'MATA02', 'u1');
  });

  it('GET /curriculo/meu-curso/componentes/:codigo/vizinhos devolve os vizinhos pelo nome do curso', async () => {
    service.vizinhosCurricularesPorNomeUsuario.mockResolvedValue({
      atual: { codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' },
      preRequisitos: [],
      desbloqueia: [],
    });
    const res = await request(app.getHttpServer())
      .get('/curriculo/meu-curso/componentes/MATA02/vizinhos')
      .query({ curso: 'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador' });
    expect(res.status).toBe(200);
    expect(service.vizinhosCurricularesPorNomeUsuario).toHaveBeenCalledWith(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
      'MATA02',
      'u1',
    );
  });

  it('GET /curriculo/meu-curso/componentes/:codigo/vizinhos sem "curso" devolve 400', async () => {
    const res = await request(app.getHttpServer()).get(
      '/curriculo/meu-curso/componentes/MATA02/vizinhos',
    );
    expect(res.status).toBe(400);
    expect(service.vizinhosCurricularesPorNomeUsuario).not.toHaveBeenCalled();
  });
```

Note: o mock do guard já existente (`ctx.switchToHttp().getRequest().user = { userId: 'u1' }`) já cobre `@CurrentUser()` — não precisa mudar.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.controller -v`
Expected: FAIL — rotas antigas ainda respondem, as novas dão 404 (rota inexistente)

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/curriculo.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import type { VizinhosCurriculares } from './vizinhos-curriculares';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

/**
 * `/curriculo/meu-curso` takes the course name as a query param for now — it
 * does not yet read `User.curso` off the authenticated user. This endpoint
 * family has a real consumer (mobile's vizinhos curriculares screen, via
 * `getVizinhosCurriculares` in `mobile/src/lib/api.ts`, hitting
 * `/curriculo/meu-curso/componentes/:codigo/vizinhos` below), but that
 * consumer still passes `curso` as a query param itself rather than
 * resolving `User.curso` server-side — that wiring is still not done.
 */
@Controller('curriculo')
@UseGuards(JwtAuthGuard)
export class CurriculoController {
  constructor(
    @Inject(CURRICULO_SERVICE) private readonly service: CurriculoService,
  ) {}

  @Get('cursos')
  async listarCursos(): Promise<CursoListaItem[]> {
    return this.service.listarCursos();
  }

  @Get('cursos/:cursoId')
  async buscarCurso(
    @Param('cursoId') cursoId: string,
  ): Promise<EstruturaCurricularSalva> {
    return this.service.resolverCurso(cursoId);
  }

  @Get('meu-curso')
  async meuCurso(
    @Query('curso') curso: string | undefined,
  ): Promise<EstruturaCurricularSalva> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.resolverPorNomeUsuario(curso);
  }

  @Get('cursos/:cursoId/componentes/:codigo/vizinhos')
  async vizinhosCurriculares(
    @Param('cursoId') cursoId: string,
    @Param('codigo') codigo: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VizinhosCurriculares> {
    return this.service.vizinhosCurriculares(cursoId, codigo, user.userId);
  }

  @Get('meu-curso/componentes/:codigo/vizinhos')
  async vizinhosCurricularesMeuCurso(
    @Param('codigo') codigo: string,
    @Query('curso') curso: string | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<VizinhosCurriculares> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.vizinhosCurricularesPorNomeUsuario(curso, codigo, user.userId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.controller -v`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npm test`
Expected: PASS (nenhuma regressão — os testes de `prisma-curriculo.repository.spec.ts`/outros specs de integração que precisam de `DATABASE_URL` continuam com o mesmo comportamento de sempre, sem relação com esta mudança)

- [ ] **Step 6: Commit**

```bash
git add backend/src/curriculo/curriculo.controller.ts backend/src/curriculo/curriculo.controller.spec.ts
git commit -m "feat(backend): rotas GET .../vizinhos (substitui .../arvore-dependencias)"
```

---

### Task 5: Tipos e client mobile (adiciona vizinhos, mantém o antigo por enquanto)

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `type SituacaoVizinho = "cursada" | "emCurso" | "liberada" | "bloqueada"`
  - `interface VizinhoCurricular { codigo: string; nome: string; situacao: SituacaoVizinho }`
  - `interface VizinhosCurricularesResponse { atual: VizinhoCurricular; preRequisitos: VizinhoCurricular[]; desbloqueia: VizinhoCurricular[] }`
  - `getVizinhosCurriculares(accessToken: string, curso: string, codigo: string): Promise<VizinhosCurricularesResponse>`

> Esta task só ADICIONA — o tipo/função antigos (`ArvoreDependenciasResponse`/`getArvoreDependencias`) continuam existindo até a Task 6, que reescreve a tela e remove os dois juntos (a tela é a única consumidora).

- [ ] **Step 1: Write the failing test**

Conferir primeiro o padrão real de mock de `fetch` já usado em `mobile/src/lib/api.test.ts` (procure o describe de `getArvoreDependencias` nesse arquivo — vai ser removido na Task 6, mas serve de referência de estilo agora) antes de escrever este teste, e seguir o mesmo padrão.

```ts
// mobile/src/lib/api.test.ts — acrescentar
describe('getVizinhosCurriculares', () => {
  it('faz GET em /curriculo/meu-curso/componentes/:codigo/vizinhos com o curso na query', async () => {
    const mockResponse = {
      atual: { codigo: 'MATA03', nome: 'Cálculo B', situacao: 'emCurso' },
      preRequisitos: [{ codigo: 'MATA02', nome: 'Cálculo A', situacao: 'cursada' }],
      desbloqueia: [],
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const resultado = await getVizinhosCurriculares('token-123', 'ENGENHARIA/PGCOMP - Salvador', 'MATA03');

    expect(resultado).toEqual(mockResponse);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/curriculo/meu-curso/componentes/MATA03/vizinhos');
    expect(url).toContain(`curso=${encodeURIComponent('ENGENHARIA/PGCOMP - Salvador')}`);
    expect(options.headers.Authorization).toBe('Bearer token-123');
  });
});
```

Ajustar o import no topo do arquivo de teste pra incluir `getVizinhosCurriculares`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest api.test -v`
Expected: FAIL — `getVizinhosCurriculares` não exportado.

- [ ] **Step 3: Write minimal implementation**

```ts
// mobile/src/lib/types.ts — acrescentar
export type SituacaoVizinho = "cursada" | "emCurso" | "liberada" | "bloqueada";

export interface VizinhoCurricular {
  codigo: string;
  nome: string;
  situacao: SituacaoVizinho;
}

export interface VizinhosCurricularesResponse {
  atual: VizinhoCurricular;
  preRequisitos: VizinhoCurricular[];
  desbloqueia: VizinhoCurricular[];
}
```

```ts
// mobile/src/lib/api.ts
// Acrescentar ao import de tipos existente (junto de ArvoreDependenciasResponse,
// que sai na Task 6):
import type {
  // ...tipos já importados,
  VizinhosCurricularesResponse,
} from "./types";

// Acrescentar ao final do arquivo:

// getVizinhosCurriculares delegates to CurriculoService.resolverCurso/
// resolverPorNomeUsuario (mesmo caminho de getArvoreDependencias) — pode
// disparar um scraping ao vivo completo do SIGAA na primeira resolução de
// um curso. Reaproveita o mesmo orçamento de timeout das outras chamadas
// baseadas em scraping.
const VIZINHOS_CURRICULARES_TIMEOUT_MS = SIGAA_DOCUMENT_TIMEOUT_MS;

/**
 * Vizinhos diretos (pré-requisitos + o que desbloqueia) de `codigo` dentro
 * da grade ativa do curso do usuário logado, com a situação (cursada/em
 * curso/liberada/bloqueada) de cada um. Mesma conveniência de
 * `/curriculo/meu-curso`: recebe o nome bruto de `User.curso` em vez de
 * resolver `cursoId` num passo à parte.
 */
export async function getVizinhosCurriculares(
  accessToken: string,
  curso: string,
  codigo: string,
): Promise<VizinhosCurricularesResponse> {
  return request<VizinhosCurricularesResponse>(
    `/curriculo/meu-curso/componentes/${encodeURIComponent(codigo)}/vizinhos?curso=${encodeURIComponent(curso)}`,
    { method: "GET", accessToken, timeoutMs: VIZINHOS_CURRICULARES_TIMEOUT_MS },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest api.test -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): client de vizinhos curriculares"
```

---

### Task 6: Tela "linha do tempo" — reescreve a tela, remove o tipo/client antigo

**Files:**
- Modify: `mobile/src/components/AppIcon.tsx`
- Rewrite: `mobile/src/app/arvore-dependencias.tsx`
- Rewrite: `mobile/src/__tests__/arvore-dependencias.test.tsx`
- Modify: `mobile/src/lib/types.ts` — remove `NoArvoreDependencias`/`ArestaArvoreDependencias`/`ArvoreDependenciasResponse`
- Modify: `mobile/src/lib/api.ts` — remove `getArvoreDependencias`/`ARVORE_DEPENDENCIAS_TIMEOUT_MS`
- Modify: `mobile/src/lib/api.test.ts` — remove o describe de `getArvoreDependencias`

**Interfaces:**
- Consumes: `getVizinhosCurriculares` (Task 5); `useAuth` (já existente, expõe `auth.user.curso` quando `auth.status === "signedIn"`); `AppIcon`/`AppIconName` (já existente).

- [ ] **Step 1: Add the missing icon**

```ts
// mobile/src/components/AppIcon.tsx — acrescentar uma entrada ao ICON_MAP
// (em qualquer posição, junto das outras — ordem não importa):
  IconLockKeyOpen: "lock-open-outline",
```

- [ ] **Step 2: Write the failing test**

Antes de escrever, confira o mock de `useAuth`/`expo-router`/`heroui-native` já usado no arquivo de teste ATUAL de `arvore-dependencias.test.tsx` (vai ser sobrescrito, mas é a referência de estilo certa neste repositório) — o teste abaixo já segue esse padrão.

```tsx
// mobile/src/__tests__/arvore-dependencias.test.tsx (arquivo inteiro, substitui o anterior)
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import VizinhosCurricularesScreen from "@/app/arvore-dependencias";
import { getVizinhosCurriculares } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ codigo: "MATA03", nome: "Cálculo B" }),
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack }),
}));

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getVizinhosCurriculares: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    Button: ({ children, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    ),
    Spinner: (props: any) => <View testID={props.testID} />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: (keys: string[]) => keys.map(() => "#888888"),
  };
});

const mockedGet = getVizinhosCurriculares as jest.MockedFunction<typeof getVizinhosCurriculares>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("VizinhosCurricularesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({
      status: "signedIn",
      accessToken: "token-123",
      user: { curso: "ENGENHARIA/PGCOMP - Salvador" },
    } as unknown as ReturnType<typeof useAuth>);
  });

  it("mostra loading enquanto a busca está em andamento", async () => {
    let resolver: ((value: Awaited<ReturnType<typeof getVizinhosCurriculares>>) => void) | undefined;
    mockedGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        })
    );

    await render(<VizinhosCurricularesScreen />);
    expect(screen.getByTestId("vizinhos-curriculares-loading")).toBeTruthy();

    resolver?.({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [{ codigo: "MATA04", nome: "Cálculo C", situacao: "bloqueada" }],
    });
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
  });

  it("mostra a matéria atual, pré-requisitos e o que ela desbloqueia", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [
        { codigo: "MATA04", nome: "Cálculo C", situacao: "bloqueada" },
        { codigo: "ENGC30", nome: "Mecânica dos Sólidos", situacao: "liberada" },
      ],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    expect(screen.getByText("Cálculo B")).toBeTruthy();
    expect(screen.getByText("Cálculo C")).toBeTruthy();
    expect(screen.getByText("Mecânica dos Sólidos")).toBeTruthy();
  });

  it("não mostra o bloco de pré-requisitos quando a matéria não tem nenhum", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" },
      preRequisitos: [],
      desbloqueia: [{ codigo: "MATA03", nome: "Cálculo B", situacao: "liberada" }],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo B")).toBeTruthy());
    expect(screen.queryByText("Pré-requisito")).toBeNull();
  });

  it("não mostra o bloco de desbloqueia quando não há nenhuma matéria", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "ENGC99", nome: "Trabalho de Conclusão", situacao: "liberada" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    expect(screen.queryByText("Desbloqueia")).toBeNull();
  });

  it("toque num card de pré-requisito navega pra ele", async () => {
    mockedGet.mockResolvedValue({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [{ codigo: "MATA02", nome: "Cálculo A", situacao: "cursada" }],
      desbloqueia: [],
    });

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByText("Cálculo A")).toBeTruthy());
    fireEvent.press(screen.getByTestId("vizinho-card-MATA02"));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/arvore-dependencias",
      params: { codigo: "MATA02", nome: "Cálculo A" },
    });
  });

  it("mostra erro quando a busca falha", async () => {
    mockedGet.mockRejectedValue(new Error("falhou"));

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());
  });

  it("tenta buscar de novo ao apertar o botão de retry no estado de erro", async () => {
    mockedGet.mockRejectedValueOnce(new Error("timeout"));

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());

    mockedGet.mockResolvedValueOnce({
      atual: { codigo: "MATA03", nome: "Cálculo B", situacao: "emCurso" },
      preRequisitos: [],
      desbloqueia: [],
    });
    fireEvent.press(screen.getByText("Tentar novamente"));

    await waitFor(() => expect(screen.getByText("Cálculo B")).toBeTruthy());
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("mostra mensagem específica quando o código raiz não está na grade ativa (404 de ComponenteDesconhecidoError)", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    // A mensagem cita o código da rota (MATA03, fixo no mock de useLocalSearchParams
    // acima) — é assim que a tela distingue esse erro do de curso não encontrado.
    mockedGet.mockRejectedValue(
      new ApiError("Component MATA03 is not in course curso-1's active curriculum structure", 404),
    );

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("vizinhos-curriculares-nao-na-grade")).toBeTruthy()
    );
  });

  it("um 404 de curso não encontrado (não cita o código) cai no estado de erro genérico", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    mockedGet.mockRejectedValue(
      new ApiError("Course ENGENHARIA DA COMPUTAÇÃO is not in the directory", 404),
    );

    await render(<VizinhosCurricularesScreen />);
    await waitFor(() => expect(screen.getByTestId("vizinhos-curriculares-erro")).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npx jest arvore-dependencias.test -v`
Expected: FAIL — módulo antigo (SVG/dagre) ainda no lugar, testes novos não batem com a tela atual.

- [ ] **Step 4: Write minimal implementation**

```tsx
// mobile/src/app/arvore-dependencias.tsx (arquivo inteiro, substitui o anterior)
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { ApiError, getVizinhosCurriculares } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  SituacaoVizinho,
  VizinhoCurricular,
  VizinhosCurricularesResponse,
} from "@/lib/types";

type Estado =
  | { status: "loading" }
  | { status: "ready"; dados: VizinhosCurricularesResponse }
  | { status: "erro" }
  // Distinta de erro genérico: o próprio código raiz não existe na grade
  // ativa do curso (ex: optativa, ou matéria de um currículo antigo, vinda
  // do histórico do aluno). A API devolve 404 (ComponenteDesconhecidoError,
  // cuja mensagem cita o código) pra diferenciar de um 404 de curso não
  // encontrado, que cai no estado de erro genérico.
  | { status: "naoNaGrade" };

const ICONE_POR_SITUACAO: Record<SituacaoVizinho, AppIconName> = {
  cursada: "IconCheck",
  emCurso: "IconClock",
  liberada: "IconLockKeyOpen",
  bloqueada: "IconLockKey",
};

const ROTULO_POR_SITUACAO: Record<SituacaoVizinho, string> = {
  cursada: "aprovada",
  emCurso: "em curso",
  liberada: "liberada",
  bloqueada: "bloqueada",
};

/**
 * Um card na linha do tempo, com o pontinho de status à esquerda (mesmo
 * vocabulário do `LinhaDoTempo` da Trajetória) e uma linha vertical
 * conectando ao próximo item — exceto no último de cada bloco (`comLinha`).
 * `destaque` marca a matéria atual (card maior, borda accent).
 */
function CardVizinho({
  vizinho,
  destaque = false,
  comLinha = true,
  onPress,
}: {
  vizinho: VizinhoCurricular;
  destaque?: boolean;
  comLinha?: boolean;
  onPress?: () => void;
}): JSX.Element {
  const [accentColor, successColor, mutedColor, foregroundColor] = useThemeColor([
    "accent",
    "success",
    "muted",
    "foreground",
  ]);
  const bloqueada = vizinho.situacao === "bloqueada";
  const preenchido = vizinho.situacao === "cursada" || vizinho.situacao === "emCurso";
  const corPonto =
    vizinho.situacao === "cursada"
      ? successColor
      : vizinho.situacao === "emCurso"
        ? accentColor
        : vizinho.situacao === "bloqueada"
          ? mutedColor
          : foregroundColor;

  const conteudo = (
    <View
      className={`flex-1 rounded-2xl p-3 flex-row items-center justify-between gap-2 ${
        destaque
          ? "bg-accent-soft border-2 border-accent"
          : bloqueada
            ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
            : "bg-surface-secondary"
      }`}
    >
      <View className="gap-0.5">
        <Typography.Paragraph weight="medium" className={destaque ? "text-accent" : undefined}>
          {vizinho.nome}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="body-xs"
          color="muted"
          className={`font-mono ${destaque ? "text-accent" : ""}`}
        >
          {vizinho.codigo} · {ROTULO_POR_SITUACAO[vizinho.situacao]}
        </Typography.Paragraph>
      </View>
      <AppIcon name={ICONE_POR_SITUACAO[vizinho.situacao]} size={20} color={corPonto} />
    </View>
  );

  return (
    <View className="flex-row gap-3">
      <View className="w-3 items-center">
        <View
          className="rounded-full mt-1"
          style={{
            width: destaque ? 14 : 10,
            height: destaque ? 14 : 10,
            backgroundColor: preenchido ? corPonto : "transparent",
            borderWidth: preenchido ? 0 : 2,
            borderColor: corPonto,
            borderStyle: bloqueada ? "dashed" : "solid",
          }}
        />
        {comLinha ? <View className="flex-1 w-px bg-white/15 mt-1" /> : null}
      </View>
      {onPress ? (
        <Pressable testID={`vizinho-card-${vizinho.codigo}`} onPress={onPress} className="flex-1 mb-3">
          {conteudo}
        </Pressable>
      ) : (
        <View testID={`vizinho-card-${vizinho.codigo}`} className="flex-1 mb-3">
          {conteudo}
        </View>
      )}
    </View>
  );
}

/**
 * Tela de navegação em cascata: matéria atual em destaque, pré-requisitos
 * diretos acima, o que ela desbloqueia diretamente abaixo — conectados por
 * uma linha do tempo vertical. Tocar num card de qualquer bloco empurra
 * uma nova instância desta mesma tela, recentrada naquela matéria.
 */
export default function VizinhosCurricularesScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { codigo, nome } = useLocalSearchParams<{ codigo: string; nome?: string }>();
  const [foregroundColor] = useThemeColor(["foreground"]);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  // Guards against setEstado firing after the modal is dismissed while the
  // fetch is still in flight (same pattern as professor/[siape].tsx).
  const ativoRef = useRef(true);

  useEffect(
    () => () => {
      ativoRef.current = false;
    },
    []
  );

  const carregar = useCallback(async () => {
    const curso = auth.status === "signedIn" ? auth.user.curso : null;
    if (auth.status !== "signedIn" || !curso || !codigo) {
      setEstado({ status: "erro" });
      return;
    }

    setEstado({ status: "loading" });
    try {
      const dados = await getVizinhosCurriculares(auth.accessToken, curso, codigo);
      if (!ativoRef.current) return;
      setEstado({ status: "ready", dados });
    } catch (error) {
      if (!ativoRef.current) return;
      // Ver o comentário do tipo Estado: distingue ComponenteDesconhecidoError
      // (a mensagem cita o código) de CursoDesconhecidoError (não cita).
      if (error instanceof ApiError && error.status === 404 && error.message.includes(codigo)) {
        setEstado({ status: "naoNaGrade" });
        return;
      }
      setEstado({ status: "erro" });
    }
  }, [auth, codigo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function abrirVizinho(vizinho: VizinhoCurricular): void {
    router.push({
      pathname: "/arvore-dependencias",
      params: { codigo: vizinho.codigo, nome: vizinho.nome },
    });
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5"
        style={{ paddingTop: insets.top + 14 }}
      >
        <Typography.Heading type="h4">{nome ?? codigo}</Typography.Heading>
        <Pressable testID="vizinhos-curriculares-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      {estado.status === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <Spinner testID="vizinhos-curriculares-loading" />
        </View>
      ) : estado.status === "erro" ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Typography.Paragraph testID="vizinhos-curriculares-erro" color="muted" align="center">
            Não foi possível carregar a trilha curricular.
          </Typography.Paragraph>
          <Button variant="outline" size="sm" onPress={() => void carregar()}>
            Tentar novamente
          </Button>
        </View>
      ) : estado.status === "naoNaGrade" ? (
        <View className="flex-1 items-center justify-center px-6">
          <Typography.Paragraph testID="vizinhos-curriculares-nao-na-grade" color="muted" align="center">
            Essa matéria não está na grade curricular ativa do curso.
          </Typography.Paragraph>
        </View>
      ) : (
        <ScrollView
          testID="vizinhos-curriculares-scroll"
          className="flex-1 px-6"
          contentContainerClassName="pb-8"
        >
          {estado.dados.preRequisitos.length > 0 ? (
            <>
              <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
                Pré-requisito
              </Typography.Paragraph>
              {estado.dados.preRequisitos.map((vizinho) => (
                <CardVizinho key={vizinho.codigo} vizinho={vizinho} onPress={() => abrirVizinho(vizinho)} />
              ))}
            </>
          ) : null}

          <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
            Você está aqui
          </Typography.Paragraph>
          <CardVizinho
            vizinho={estado.dados.atual}
            destaque
            comLinha={estado.dados.desbloqueia.length > 0}
          />

          {estado.dados.desbloqueia.length > 0 ? (
            <>
              <Typography.Paragraph type="body-xs" color="muted" className="mb-2 ml-9">
                Desbloqueia
              </Typography.Paragraph>
              {estado.dados.desbloqueia.map((vizinho, i) => (
                <CardVizinho
                  key={vizinho.codigo}
                  vizinho={vizinho}
                  comLinha={i < estado.dados.desbloqueia.length - 1}
                  onPress={() => abrirVizinho(vizinho)}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
```

Agora remova de `mobile/src/lib/types.ts` as interfaces `NoArvoreDependencias`, `ArestaArvoreDependencias` e `ArvoreDependenciasResponse` (a tela era a única consumidora — `getArvoreDependencias`, removido a seguir, era o outro).

Remova de `mobile/src/lib/api.ts` a constante `ARVORE_DEPENDENCIAS_TIMEOUT_MS` e a função `getArvoreDependencias` inteira, e o import de `ArvoreDependenciasResponse`.

Remova de `mobile/src/lib/api.test.ts` o `describe('getArvoreDependencias', ...)` inteiro e o import correspondente.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest arvore-dependencias.test api.test -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mobile/src/components/AppIcon.tsx mobile/src/app/arvore-dependencias.tsx mobile/src/__tests__/arvore-dependencias.test.tsx mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): tela de vizinhos curriculares em linha do tempo (substitui o grafo SVG)"
```

---

### Task 7: Remove `dagre`, o patch do `graphlib` e o pan/zoom

**Files:**
- Delete: `mobile/src/lib/arvore-dependencias-layout.ts`
- Delete: `mobile/src/lib/arvore-dependencias-layout.test.ts`
- Delete: `mobile/src/lib/pan-zoom.ts`
- Delete: `mobile/src/lib/pan-zoom.test.ts`
- Delete: `mobile/patches/graphlib+2.1.8.patch`
- Modify: `mobile/package.json`

**Interfaces:**
- Nenhuma — depois da Task 6, nada mais importa `arvore-dependencias-layout.ts`/`pan-zoom.ts` (a tela reescrita não usa nenhum dos dois). Confirme antes de deletar.

- [ ] **Step 1: Confirm nothing else imports the files being removed**

Run: `cd mobile && grep -rln "arvore-dependencias-layout\|lib/pan-zoom" src/`
Expected: nenhum resultado (se aparecer algo além dos próprios arquivos sendo removidos, pare e investigue antes de continuar — algo além da tela antiga ainda depende deles).

- [ ] **Step 2: Delete the files**

```bash
cd mobile
rm src/lib/arvore-dependencias-layout.ts src/lib/arvore-dependencias-layout.test.ts
rm src/lib/pan-zoom.ts src/lib/pan-zoom.test.ts
rm patches/graphlib+2.1.8.patch
rmdir patches 2>/dev/null || true
```

- [ ] **Step 3: Remove `dagre`/`@types/dagre`/`patch-package` from package.json**

Abra `mobile/package.json` e remova:
- A entrada `"dagre": "^0.8.5",` de `dependencies`
- A entrada `"@types/dagre": "^0.7.54",` de `devDependencies`
- A entrada `"patch-package": "..."` de `devDependencies` (a versão exata é a que estiver lá — confira antes de remover)
- O script `"postinstall": "patch-package"` de `scripts`

Depois, reinstale para atualizar o lockfile:

```bash
npm install
```

- [ ] **Step 4: Run the whole mobile suite**

Run: `cd mobile && npm test`
Expected: PASS — nenhum teste referenciava esses arquivos fora dos próprios (já deletados junto com eles). Confirme também que o app ainda builda: `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A mobile/src/lib/arvore-dependencias-layout.ts mobile/src/lib/arvore-dependencias-layout.test.ts mobile/src/lib/pan-zoom.ts mobile/src/lib/pan-zoom.test.ts mobile/patches mobile/package.json mobile/package-lock.json
git commit -m "chore(mobile): remove dagre, o patch do graphlib e o pan/zoom (não usados mais)"
```

---

### Task 8: Toque no card de matéria da Trajetória — renomeia `onAbrirArvore` → `onAbrirVizinhos`

**Files:**
- Modify: `mobile/src/screens/TrajetoriaTab.tsx` (ou `mobile/src/app/(tabs)/trajetoria.tsx` — ver nota no topo do plano sobre esse caminho)
- Modify: `mobile/src/__tests__/trajetoria.test.tsx`

**Interfaces:**
- Consumes: rota `arvore-dependencias` (Task 6, mesmo caminho de arquivo, conteúdo novo).

Esta é uma renomeação puramente cosmética — a wiring (tocar no `MateriaCard` empurra a mesma rota com `codigo`/`nome`) não muda. Só o nome da prop, pra não sugerir "árvore"/"grafo" em código que não desenha nada disso mais.

- [ ] **Step 1: Write the failing test**

Localize o teste existente "toque num card de matéria cursada abre a árvore de dependências" em `mobile/src/__tests__/trajetoria.test.tsx` e renomeie só a descrição (mantendo a asserção igual — ela já verifica `router.push` com o `pathname`/`params` certos, que não mudam):

```tsx
// mobile/src/__tests__/trajetoria.test.tsx
it("toque num card de matéria cursada abre a trilha curricular", async () => {
  // corpo do teste inalterado — mesma asserção de mockRouterPush
});
```

- [ ] **Step 2: Run test to verify it still passes (rename-only, no behavior change)**

Run: `cd mobile && npx jest trajetoria.test -v`
Expected: PASS (o teste não mudou de comportamento, só de nome)

- [ ] **Step 3: Rename `onAbrirArvore` to `onAbrirVizinhos` throughout the file**

Em `mobile/src/screens/TrajetoriaTab.tsx` (ou `mobile/src/app/(tabs)/trajetoria.tsx`), troque toda ocorrência do identificador `onAbrirArvore` por `onAbrirVizinhos` — na prop passada de `TrajetoriaTab` pra `ReadyTrajetoria`, na assinatura de `ReadyTrajetoria`, na passagem pra `LinhaDoTempo`, na assinatura de `LinhaDoTempo`, na passagem pra `MateriaCard`, e na assinatura de `MateriaCard`. O corpo de cada função e a wiring (`router.push({ pathname: "/arvore-dependencias", params: { codigo, nome } })`, `onPress={() => onAbrirVizinhos(componente.codigo, componente.nome)}`) não mudam — só o nome.

- [ ] **Step 4: Run test to verify it still passes**

Run: `cd mobile && npx jest trajetoria.test -v`
Expected: PASS

- [ ] **Step 5: Run the whole mobile suite**

Run: `cd mobile && npm test`
Expected: PASS (nenhuma regressão)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/TrajetoriaTab.tsx mobile/src/__tests__/trajetoria.test.tsx
git commit -m "refactor(mobile): renomeia onAbrirArvore para onAbrirVizinhos"
```

---

## Self-Review Notes

- **Spec coverage:** avaliador booleano E/OU (Task 1), vizinhos diretos + situação (Task 2), integração com histórico via JWT + endpoint novo (Tasks 3-4), tela "linha do tempo" com navegação em cascata (Tasks 5-6), remoção de `dagre`/patch/pan-zoom (Task 7), wiring do trigger renomeado (Task 8) — todas as seções da spec têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"similar à task anterior" — cada step de código tem o código completo, incluindo os arquivos inteiros reescritos (Task 6) e os trechos exatos a remover (Tasks 3, 6, 7).
- **Type consistency:** `SituacaoVizinho`/`VizinhoCurricular`/`VizinhosCurriculares` (backend, Task 2) ecoam campo-a-campo em `SituacaoVizinho`/`VizinhoCurricular`/`VizinhosCurricularesResponse` (mobile, Task 5) — mesmos nomes de campo, só o topo renomeado com sufixo `Response` seguindo a convenção já usada em `types.ts` (`TrajetoriaResponse`, `ScheduleResponse`). `montarVizinhos` (Task 2) é exatamente o que `CurriculoService.vizinhosCurriculares`/`vizinhosCurricularesPorNomeUsuario` (Task 3) chamam. `getVizinhosCurriculares` (Task 5) devolve exatamente o formato que a tela (Task 6) espera.
- O construtor de `CurriculoService` ganha um 4º parâmetro com default (`historicoRepository`) em vez de forçar todos os 14 testes pré-existentes de `listarCursos`/`resolverCurso`/`resolverPorNomeUsuario` a passar um novo argumento — decisão deliberada pra manter esta entrega focada, já registrada na Task 3.
- Task 6 é a maior do plano (rewrite completo da tela + remoção coordenada de tipo/client antigos) porque esses três pontos são atomicamente acoplados — não dá pra remover `getArvoreDependencias`/`ArvoreDependenciasResponse` antes de trocar sua única consumidora sem deixar o build quebrado entre commits.
