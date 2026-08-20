# Árvore de Dependências (grafo por matéria) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tocar num card de matéria na tela de Trajetória abre um modal com um grafo visual (nós + arestas, DAG real) mostrando todas as matérias que dependem daquela matéria (direta ou transitivamente), via pré-requisito.

**Architecture:** Backend extrai códigos citados no texto cru de `preRequisito` de cada `ComponenteCurricular` da estrutura curricular ativa, filtra contra os códigos que realmente existem na grade, monta um índice reverso e faz BFS a partir do código raiz — devolvendo `{ nos, arestas }` achatado por um novo endpoint. Mobile consome isso, calcula o layout do DAG com `dagre` (posições x/y, pontos de aresta) e desenha com `react-native-svg`, com pan/zoom via `react-native-gesture-handler` + `react-native-reanimated`.

**Tech Stack:** NestJS + Prisma (backend, já existente), Expo/React Native (mobile, já existente). Nova dependência mobile: `dagre` (+ `@types/dagre`).

**Spec:** [docs/superpowers/specs/2026-08-20-arvore-dependencias-design.md](../specs/2026-08-20-arvore-dependencias-design.md)

## Global Constraints

- Grafo ignora a lógica E/OU do pré-requisito — toda referência citada vira aresta igual, sem diferenciar obrigatório de alternativo.
- Um código citado só vira nó/aresta se existir como `codigo` de outro `ComponenteCurricular` da **mesma** `EstruturaCurricular` — código que não bate com nenhum componente da grade ativa é descartado silenciosamente (não é erro).
- Direção do grafo é sempre **descendentes** (quem depende da matéria raiz) — sem direção inversa nesta entrega.
- Sem limite de profundidade/tamanho — pan/zoom é a resposta para grafos grandes.
- Toque num nó do grafo: nenhuma ação (v1 é só visual).
- Endpoint novo não dispara scraping ao vivo — só lê a estrutura curricular já persistida (mesma leitura que `resolverCurso`/`resolverPorNomeUsuario` já fazem).
- JWT-guarded, mesma convenção do resto do módulo `curriculo`.

---

## File Structure

**Backend:**
- Create: `backend/src/curriculo/arvore-dependencias.ts` — módulo puro: extração de códigos, filtro, índice reverso, BFS. Sem I/O.
- Create: `backend/src/curriculo/arvore-dependencias.spec.ts` — testes do módulo puro.
- Modify: `backend/src/curriculo/curriculo.service.ts` — dois métodos novos (`arvoreDependencias`, `arvoreDependenciasPorNomeUsuario`) que reaproveitam `resolverCurso`/`resolverPorNomeUsuario` e delegam a `arvore-dependencias.ts`.
- Modify: `backend/src/curriculo/curriculo.service.spec.ts` — testes desses dois métodos.
- Modify: `backend/src/curriculo/curriculo.controller.ts` — duas rotas novas.
- Modify: `backend/src/curriculo/curriculo.controller.spec.ts` — testes dessas rotas.

**Mobile:**
- Modify: `mobile/src/lib/types.ts` — tipos `NoArvoreDependencias`, `ArestaArvoreDependencias`, `ArvoreDependenciasResponse`.
- Modify: `mobile/src/lib/api.ts` — `getArvoreDependencias`.
- Modify: `mobile/src/lib/api.test.ts` — teste do client novo.
- Create: `mobile/src/lib/arvore-dependencias-layout.ts` — função pura que roda o `dagre` sobre a resposta do endpoint e devolve posições/pontos.
- Create: `mobile/src/lib/arvore-dependencias-layout.test.ts` — testes dessa função, sem renderizar nada.
- Create: `mobile/src/app/arvore-dependencias.tsx` — o modal: busca, loading/vazio/erro, renderização SVG + pan/zoom.
- Create: `mobile/src/__tests__/arvore-dependencias.test.tsx` — testes do modal (loading/vazio/erro/dados).
- Modify: `mobile/src/app/_layout.tsx` — registra a nova rota como modal.
- Modify: `mobile/src/app/(tabs)/trajetoria.tsx` — `MateriaCard` vira `Pressable`, navega pro modal.
- Modify: `mobile/src/__tests__/trajetoria.test.tsx` — teste do toque no card.
- Modify: `mobile/package.json` — adiciona `dagre` + `@types/dagre`.

---

### Task 1: Extração de códigos e filtro contra a grade (backend, puro)

**Files:**
- Create: `backend/src/curriculo/arvore-dependencias.ts`
- Test: `backend/src/curriculo/arvore-dependencias.spec.ts`

**Interfaces:**
- Produces: `extrairCodigosCitados(texto: string | null): string[]` — códigos únicos citados no texto, na ordem em que aparecem, sem duplicatas.

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/arvore-dependencias.spec.ts
import { extrairCodigosCitados } from './arvore-dependencias';

describe('extrairCodigosCitados', () => {
  it('extrai códigos de uma expressão com E', () => {
    expect(extrairCodigosCitados('FISD36 E FISD42')).toEqual(['FISD36', 'FISD42']);
  });

  it('extrai códigos de uma expressão com E e OU e parênteses', () => {
    expect(extrairCodigosCitados('(FISD36 E FISD42) OU (ENGJ18)')).toEqual([
      'FISD36',
      'FISD42',
      'ENGJ18',
    ]);
  });

  it('não duplica um código citado mais de uma vez', () => {
    expect(extrairCodigosCitados('(MATA02) OU (MATA02 E FISD36)')).toEqual([
      'MATA02',
      'FISD36',
    ]);
  });

  it('devolve lista vazia para texto nulo ou sem pré-requisito', () => {
    expect(extrairCodigosCitados(null)).toEqual([]);
    expect(extrairCodigosCitados('')).toEqual([]);
  });

  it('reconhece código com letra final (ex: equivalência ENG295A)', () => {
    expect(extrairCodigosCitados('ENG295A')).toEqual(['ENG295A']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest arvore-dependencias -v`
Expected: FAIL — `Cannot find module './arvore-dependencias'`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/arvore-dependencias.ts

// Case: "(FISD36 E FISD42) OU (ENGJ18)" — captura o código de disciplina bruto
// (letras maiúsculas seguidas de dígitos, com uma letra final opcional para
// variantes de equivalência como "ENG295A"), ignorando por completo a
// estrutura lógica E/OU/parênteses ao redor. Ver spec: "Fidelidade E/OU" foi
// decidida como fora de escopo.
const CODIGO_PATTERN = /[A-Z]{2,6}\d{1,4}[A-Z]?/g;

export function extrairCodigosCitados(texto: string | null): string[] {
  if (!texto) {
    return [];
  }
  const encontrados = texto.match(CODIGO_PATTERN) ?? [];
  return [...new Set(encontrados)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest arvore-dependencias -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/arvore-dependencias.ts backend/src/curriculo/arvore-dependencias.spec.ts
git commit -m "feat(backend): extrai códigos citados no texto de pré-requisito"
```

---

### Task 2: Índice reverso + BFS de descendentes (backend, puro)

**Files:**
- Modify: `backend/src/curriculo/arvore-dependencias.ts`
- Modify: `backend/src/curriculo/arvore-dependencias.spec.ts`

**Interfaces:**
- Consumes: `extrairCodigosCitados` (Task 1).
- Produces:
  - `interface NoArvore { codigo: string; nome: string; periodo: number | null }`
  - `interface ArestaArvore { de: string; para: string }`
  - `interface ArvoreDependencias { nos: NoArvore[]; arestas: ArestaArvore[] }`
  - `interface ComponenteParaArvore { codigo: string; nome: string; periodo: number | null; preRequisito: string | null }`
  - `construirArvoreDependencias(componentes: ComponenteParaArvore[], codigoRaiz: string): ArvoreDependencias`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/arvore-dependencias.spec.ts — acrescentar ao arquivo do Task 1
import { construirArvoreDependencias, type ComponenteParaArvore } from './arvore-dependencias';

describe('construirArvoreDependencias', () => {
  const componentes: ComponenteParaArvore[] = [
    { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1, preRequisito: null },
    { codigo: 'FISB08', nome: 'Física B', periodo: 2, preRequisito: null },
    {
      codigo: 'MATA03',
      nome: 'Cálculo B',
      periodo: 2,
      preRequisito: '(MATA02)',
    },
    {
      codigo: 'ENGB01',
      nome: 'Mecânica dos Sólidos',
      periodo: 3,
      // Cita um código (ENGJ18) que não existe nesta grade — deve ser
      // ignorado, não vira nó nem aresta.
      preRequisito: '(MATA03 E FISB08) OU (ENGJ18)',
    },
    { codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4, preRequisito: 'ENGB01' },
    { codigo: 'HISA01', nome: 'História Geral', periodo: 1, preRequisito: null },
  ];

  it('monta o DAG completo de descendentes a partir da raiz', () => {
    const arvore = construirArvoreDependencias(componentes, 'MATA02');
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(
      ['MATA02', 'MATA03', 'ENGB01', 'ENGC02'].sort(),
    );
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'MATA02', para: 'MATA03' },
        { de: 'MATA03', para: 'ENGB01' },
        { de: 'ENGB01', para: 'ENGC02' },
      ]),
    );
    // FISB08 e HISA01 não são descendentes de MATA02 e não devem aparecer.
    expect(arvore.nos.map((n) => n.codigo)).not.toContain('FISB08');
    expect(arvore.nos.map((n) => n.codigo)).not.toContain('HISA01');
  });

  it('nó com múltiplos pais aparece uma única vez, com uma aresta por pai', () => {
    const arvore = construirArvoreDependencias(componentes, 'FISB08');
    // FISB08 é citado por ENGB01, que também depende de MATA03 → MATA02.
    // A partir de FISB08 só o ramo ENGB01→ENGC02 é alcançável.
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['FISB08', 'ENGB01', 'ENGC02'].sort());
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'FISB08', para: 'ENGB01' },
        { de: 'ENGB01', para: 'ENGC02' },
      ]),
    );
  });

  it('matéria sem nenhum descendente devolve grafo com só o nó raiz e nenhuma aresta', () => {
    const arvore = construirArvoreDependencias(componentes, 'ENGC02');
    expect(arvore.nos).toEqual([{ codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4 }]);
    expect(arvore.arestas).toEqual([]);
  });

  it('código raiz que não existe na grade devolve grafo vazio', () => {
    expect(construirArvoreDependencias(componentes, 'XXXX00')).toEqual({ nos: [], arestas: [] });
  });

  it('não entra em loop infinito com um ciclo (defensivo — não esperado num currículo real)', () => {
    const comCiclo: ComponenteParaArvore[] = [
      { codigo: 'A1', nome: 'A', periodo: 1, preRequisito: 'B1' },
      { codigo: 'B1', nome: 'B', periodo: 1, preRequisito: 'A1' },
    ];
    const arvore = construirArvoreDependencias(comCiclo, 'A1');
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['A1', 'B1']);
    expect(arvore.arestas).toEqual(
      expect.arrayContaining([
        { de: 'A1', para: 'B1' },
        { de: 'B1', para: 'A1' },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest arvore-dependencias -v`
Expected: FAIL — `construirArvoreDependencias` não exportado.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/arvore-dependencias.ts — acrescentar ao arquivo do Task 1

export interface NoArvore {
  codigo: string;
  nome: string;
  periodo: number | null;
}

export interface ArestaArvore {
  de: string;
  para: string;
}

export interface ArvoreDependencias {
  nos: NoArvore[];
  arestas: ArestaArvore[];
}

export interface ComponenteParaArvore {
  codigo: string;
  nome: string;
  periodo: number | null;
  preRequisito: string | null;
}

/**
 * A partir do código raiz, coleta via BFS todo componente alcançável no
 * índice reverso "quem cita este código no próprio pré-requisito" — ou seja,
 * a árvore de quem *depende* da raiz, não o inverso.
 *
 * Um código citado no texto que não bate com nenhum `codigo` desta mesma
 * lista de componentes (referência a currículo antigo/outro curso/optativa
 * fora da grade) é descartado silenciosamente — nunca vira nó nem aresta.
 * Ver spec, seção "Extração de códigos e filtro contra a grade".
 */
export function construirArvoreDependencias(
  componentes: ComponenteParaArvore[],
  codigoRaiz: string,
): ArvoreDependencias {
  const porCodigo = new Map(componentes.map((c) => [c.codigo, c]));
  if (!porCodigo.has(codigoRaiz)) {
    return { nos: [], arestas: [] };
  }

  const filhosDe = new Map<string, Set<string>>();
  for (const componente of componentes) {
    const citados = extrairCodigosCitados(componente.preRequisito).filter((codigo) =>
      porCodigo.has(codigo),
    );
    for (const citado of citados) {
      if (!filhosDe.has(citado)) {
        filhosDe.set(citado, new Set());
      }
      filhosDe.get(citado)!.add(componente.codigo);
    }
  }

  const visitados = new Set<string>([codigoRaiz]);
  const arestas: ArestaArvore[] = [];
  const fila = [codigoRaiz];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    for (const filho of filhosDe.get(atual) ?? []) {
      arestas.push({ de: atual, para: filho });
      if (!visitados.has(filho)) {
        visitados.add(filho);
        fila.push(filho);
      }
    }
  }

  const nos: NoArvore[] = [...visitados].map((codigo) => {
    const c = porCodigo.get(codigo)!;
    return { codigo: c.codigo, nome: c.nome, periodo: c.periodo };
  });

  return { nos, arestas };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest arvore-dependencias -v`
Expected: PASS (10 tests no total do arquivo)

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/arvore-dependencias.ts backend/src/curriculo/arvore-dependencias.spec.ts
git commit -m "feat(backend): monta o DAG de descendentes via índice reverso + BFS"
```

---

### Task 3: `CurriculoService` — dois métodos novos

**Files:**
- Modify: `backend/src/curriculo/curriculo.service.ts`
- Modify: `backend/src/curriculo/curriculo.service.spec.ts`

**Interfaces:**
- Consumes: `construirArvoreDependencias`, `ArvoreDependencias` (Task 2); `resolverCurso`, `resolverPorNomeUsuario` (já existentes em `curriculo.service.ts`).
- Produces:
  - `CurriculoService.arvoreDependencias(cursoId: string, codigo: string): Promise<ArvoreDependencias>`
  - `CurriculoService.arvoreDependenciasPorNomeUsuario(nomeCurso: string, codigo: string): Promise<ArvoreDependencias>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/curriculo.service.spec.ts — acrescentar ao describe existente,
// dentro de um novo describe('arvoreDependencias', ...) no mesmo arquivo.
// (Import já existente: import { CurriculoService, ... } from './curriculo.service';)

describe('arvoreDependencias / arvoreDependenciasPorNomeUsuario', () => {
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

  it('arvoreDependencias busca a estrutura já resolvida e monta o grafo', async () => {
    const repository = fakeRepository({
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    const service = new CurriculoService(fakeHttp({}), repository);
    const arvore = await service.arvoreDependencias('curso-1', 'MATA02');
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['MATA02', 'MATA03']);
    expect(arvore.arestas).toEqual([{ de: 'MATA02', para: 'MATA03' }]);
  });

  it('arvoreDependenciasPorNomeUsuario resolve o curso pelo nome e monta o grafo', async () => {
    const repository = fakeRepository({
      buscarCursos: jest.fn().mockResolvedValue([
        { idSigaa: 'curso-1', nome: 'ENGENHARIA DA COMPUTAÇÃO', sede: 'SALVADOR', nivel: 'G' },
      ]),
      buscarDiretorioAtualizadoEm: jest.fn().mockResolvedValue(new Date('2026-01-01T00:00:00Z')),
      buscarEstrutura: jest.fn().mockResolvedValue(estruturaSalva),
    });
    const service = new CurriculoService(fakeHttp({}), repository);
    const arvore = await service.arvoreDependenciasPorNomeUsuario(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
      'MATA02',
    );
    expect(arvore.nos.map((n) => n.codigo).sort()).toEqual(['MATA02', 'MATA03']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.service -v`
Expected: FAIL — `service.arvoreDependencias is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/curriculo.service.ts
// Adicionar ao topo dos imports:
import {
  construirArvoreDependencias,
  type ArvoreDependencias,
} from './arvore-dependencias';

// Adicionar dentro da classe CurriculoService, após resolverPorNomeUsuario:

  /**
   * Grafo de descendentes de `codigo` dentro da estrutura curricular já
   * resolvida/persistida de `cursoId` — não dispara scraping ao vivo (só lê
   * o que `resolverCurso` já teria trazido). `resolverCurso` já sabe servir
   * a linha em cache ou re-resolver se vencida, então essa mesma regra vale
   * aqui de graça.
   */
  async arvoreDependencias(cursoId: string, codigo: string): Promise<ArvoreDependencias> {
    const estrutura = await this.resolverCurso(cursoId);
    return construirArvoreDependencias(estrutura.componentes, codigo);
  }

  /** Mesma conveniência de `resolverPorNomeUsuario`, aplicada ao grafo. */
  async arvoreDependenciasPorNomeUsuario(
    nomeCurso: string,
    codigo: string,
  ): Promise<ArvoreDependencias> {
    const estrutura = await this.resolverPorNomeUsuario(nomeCurso);
    return construirArvoreDependencias(estrutura.componentes, codigo);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.service -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/curriculo/curriculo.service.ts backend/src/curriculo/curriculo.service.spec.ts
git commit -m "feat(backend): CurriculoService monta a árvore de dependências"
```

---

### Task 4: Rotas do controller

**Files:**
- Modify: `backend/src/curriculo/curriculo.controller.ts`
- Modify: `backend/src/curriculo/curriculo.controller.spec.ts`

**Interfaces:**
- Consumes: `CurriculoService.arvoreDependencias`, `CurriculoService.arvoreDependenciasPorNomeUsuario` (Task 3).
- Produces:
  - `GET /curriculo/cursos/:cursoId/componentes/:codigo/arvore-dependencias`
  - `GET /curriculo/meu-curso/componentes/:codigo/arvore-dependencias?curso=`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/curriculo/curriculo.controller.spec.ts
// Ajustar o mock do service (linha ~11) para incluir os dois métodos novos:
  const service: jest.Mocked<
    Pick<
      CurriculoService,
      | 'listarCursos'
      | 'resolverCurso'
      | 'resolverPorNomeUsuario'
      | 'arvoreDependencias'
      | 'arvoreDependenciasPorNomeUsuario'
    >
  > = {
    listarCursos: jest.fn(),
    resolverCurso: jest.fn(),
    resolverPorNomeUsuario: jest.fn(),
    arvoreDependencias: jest.fn(),
    arvoreDependenciasPorNomeUsuario: jest.fn(),
  };

// Acrescentar ao final do describe:
  it('GET /curriculo/cursos/:cursoId/componentes/:codigo/arvore-dependencias devolve o grafo', async () => {
    service.arvoreDependencias.mockResolvedValue({
      nos: [{ codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 }],
      arestas: [],
    });
    const res = await request(app.getHttpServer()).get(
      '/curriculo/cursos/1/componentes/MATA02/arvore-dependencias',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nos: [{ codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 }],
      arestas: [],
    });
    expect(service.arvoreDependencias).toHaveBeenCalledWith('1', 'MATA02');
  });

  it('GET /curriculo/meu-curso/componentes/:codigo/arvore-dependencias devolve o grafo pelo nome do curso', async () => {
    service.arvoreDependenciasPorNomeUsuario.mockResolvedValue({ nos: [], arestas: [] });
    const res = await request(app.getHttpServer())
      .get('/curriculo/meu-curso/componentes/MATA02/arvore-dependencias')
      .query({ curso: 'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador' });
    expect(res.status).toBe(200);
    expect(service.arvoreDependenciasPorNomeUsuario).toHaveBeenCalledWith(
      'ENGENHARIA DE COMPUTAÇÃO/PGCOMP - Salvador',
      'MATA02',
    );
  });

  it('GET /curriculo/meu-curso/componentes/:codigo/arvore-dependencias sem "curso" devolve 400', async () => {
    const res = await request(app.getHttpServer()).get(
      '/curriculo/meu-curso/componentes/MATA02/arvore-dependencias',
    );
    expect(res.status).toBe(400);
    expect(service.arvoreDependenciasPorNomeUsuario).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.controller -v`
Expected: FAIL — rotas ainda não existem (404).

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/curriculo/curriculo.controller.ts
// Adicionar ao import existente de tipos:
import type { ArvoreDependencias } from './arvore-dependencias';

// Adicionar dentro da classe, após buscarCurso:

  @Get('cursos/:cursoId/componentes/:codigo/arvore-dependencias')
  async arvoreDependencias(
    @Param('cursoId') cursoId: string,
    @Param('codigo') codigo: string,
  ): Promise<ArvoreDependencias> {
    return this.service.arvoreDependencias(cursoId, codigo);
  }

  @Get('meu-curso/componentes/:codigo/arvore-dependencias')
  async arvoreDependenciasMeuCurso(
    @Param('codigo') codigo: string,
    @Query('curso') curso: string | undefined,
  ): Promise<ArvoreDependencias> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.arvoreDependenciasPorNomeUsuario(curso, codigo);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest curriculo.controller -v`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite before moving to mobile**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npm test`
Expected: PASS (nenhuma regressão nos módulos existentes)

- [ ] **Step 6: Commit**

```bash
git add backend/src/curriculo/curriculo.controller.ts backend/src/curriculo/curriculo.controller.spec.ts
git commit -m "feat(backend): endpoints de árvore de dependências"
```

---

### Task 5: Tipos e client mobile

**Files:**
- Modify: `mobile/src/lib/types.ts`
- Modify: `mobile/src/lib/api.ts`
- Modify: `mobile/src/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `interface NoArvoreDependencias { codigo: string; nome: string; periodo: number | null }`
  - `interface ArestaArvoreDependencias { de: string; para: string }`
  - `interface ArvoreDependenciasResponse { nos: NoArvoreDependencias[]; arestas: ArestaArvoreDependencias[] }`
  - `getArvoreDependencias(accessToken: string, curso: string, codigo: string): Promise<ArvoreDependenciasResponse>`

- [ ] **Step 1: Write the failing test**

Verificar primeiro o padrão de mock de `fetch` já usado em `mobile/src/lib/api.test.ts` (provavelmente `global.fetch = jest.fn()...`) e seguir o mesmo padrão. Acrescentar:

```ts
// mobile/src/lib/api.test.ts — acrescentar ao arquivo
describe('getArvoreDependencias', () => {
  it('faz GET em /curriculo/meu-curso/componentes/:codigo/arvore-dependencias com o curso na query', async () => {
    const mockResponse = { nos: [{ codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 }], arestas: [] };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const resultado = await getArvoreDependencias('token-123', 'ENGENHARIA/PGCOMP - Salvador', 'MATA02');

    expect(resultado).toEqual(mockResponse);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/curriculo/meu-curso/componentes/MATA02/arvore-dependencias');
    expect(url).toContain(`curso=${encodeURIComponent('ENGENHARIA/PGCOMP - Salvador')}`);
    expect(options.headers.Authorization).toBe('Bearer token-123');
  });
});
```

Ajustar o import no topo do arquivo de teste para incluir `getArvoreDependencias`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest api.test -v`
Expected: FAIL — `getArvoreDependencias` não exportado.

- [ ] **Step 3: Write minimal implementation**

```ts
// mobile/src/lib/types.ts — acrescentar
export interface NoArvoreDependencias {
  codigo: string;
  nome: string;
  periodo: number | null;
}

export interface ArestaArvoreDependencias {
  de: string;
  para: string;
}

export interface ArvoreDependenciasResponse {
  nos: NoArvoreDependencias[];
  arestas: ArestaArvoreDependencias[];
}
```

```ts
// mobile/src/lib/api.ts
// Acrescentar ao import de tipos existente:
import type {
  // ...tipos já importados,
  ArvoreDependenciasResponse,
} from "./types";

// Acrescentar ao final do arquivo:

/**
 * Grafo de descendentes (matérias que têm `codigo` como pré-requisito,
 * direta ou transitivamente) dentro da grade ativa do curso do usuário
 * logado. Mesma conveniência de `/curriculo/meu-curso`: recebe o nome bruto
 * de `User.curso` em vez de resolver `cursoId` num passo à parte.
 */
export async function getArvoreDependencias(
  accessToken: string,
  curso: string,
  codigo: string,
): Promise<ArvoreDependenciasResponse> {
  return request<ArvoreDependenciasResponse>(
    `/curriculo/meu-curso/componentes/${encodeURIComponent(codigo)}/arvore-dependencias?curso=${encodeURIComponent(curso)}`,
    { method: "GET", accessToken },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest api.test -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/types.ts mobile/src/lib/api.ts mobile/src/lib/api.test.ts
git commit -m "feat(mobile): client da árvore de dependências"
```

---

### Task 6: Layout do DAG com `dagre` (mobile, puro)

**Files:**
- Modify: `mobile/package.json` (adiciona `dagre`, `@types/dagre`)
- Create: `mobile/src/lib/arvore-dependencias-layout.ts`
- Create: `mobile/src/lib/arvore-dependencias-layout.test.ts`

**Interfaces:**
- Consumes: `ArvoreDependenciasResponse` (Task 5).
- Produces:
  - `interface NoLayout { codigo: string; nome: string; x: number; y: number; largura: number; altura: number }`
  - `interface ArestaLayout { de: string; para: string; pontos: { x: number; y: number }[] }`
  - `interface LayoutArvore { nos: NoLayout[]; arestas: ArestaLayout[]; largura: number; altura: number }`
  - `construirLayout(arvore: ArvoreDependenciasResponse): LayoutArvore`

- [ ] **Step 1: Install the dependency**

```bash
cd mobile && npm install dagre && npm install --save-dev @types/dagre
```

- [ ] **Step 2: Write the failing test**

```ts
// mobile/src/lib/arvore-dependencias-layout.test.ts
import { construirLayout } from './arvore-dependencias-layout';

describe('construirLayout', () => {
  it('calcula posições numéricas para cada nó e pontos para cada aresta', () => {
    const layout = construirLayout({
      nos: [
        { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 },
        { codigo: 'MATA03', nome: 'Cálculo B', periodo: 2 },
        { codigo: 'ENGB01', nome: 'Mecânica dos Sólidos', periodo: 3 },
      ],
      arestas: [
        { de: 'MATA02', para: 'MATA03' },
        { de: 'MATA03', para: 'ENGB01' },
      ],
    });

    expect(layout.nos).toHaveLength(3);
    for (const no of layout.nos) {
      expect(typeof no.x).toBe('number');
      expect(typeof no.y).toBe('number');
      expect(Number.isNaN(no.x)).toBe(false);
      expect(Number.isNaN(no.y)).toBe(false);
    }
    // MATA02 é raiz (rank mais alto na hierarquia) — deve vir "antes" (y menor)
    // que seus descendentes num layout top-to-bottom.
    const porCodigo = Object.fromEntries(layout.nos.map((n) => [n.codigo, n]));
    expect(porCodigo.MATA02.y).toBeLessThan(porCodigo.MATA03.y);
    expect(porCodigo.MATA03.y).toBeLessThan(porCodigo.ENGB01.y);

    expect(layout.arestas).toHaveLength(2);
    for (const aresta of layout.arestas) {
      expect(aresta.pontos.length).toBeGreaterThan(0);
    }
    expect(layout.largura).toBeGreaterThan(0);
    expect(layout.altura).toBeGreaterThan(0);
  });

  it('nó com múltiplos pais aparece uma única vez no layout', () => {
    const layout = construirLayout({
      nos: [
        { codigo: 'MATA02', nome: 'Cálculo A', periodo: 1 },
        { codigo: 'FISB08', nome: 'Física B', periodo: 1 },
        { codigo: 'ENGB01', nome: 'Mecânica dos Sólidos', periodo: 2 },
      ],
      arestas: [
        { de: 'MATA02', para: 'ENGB01' },
        { de: 'FISB08', para: 'ENGB01' },
      ],
    });
    expect(layout.nos.filter((n) => n.codigo === 'ENGB01')).toHaveLength(1);
    expect(layout.arestas).toHaveLength(2);
  });

  it('grafo com só o nó raiz (sem descendentes) não quebra', () => {
    const layout = construirLayout({
      nos: [{ codigo: 'ENGC02', nome: 'Estruturas de Concreto', periodo: 4 }],
      arestas: [],
    });
    expect(layout.nos).toHaveLength(1);
    expect(layout.arestas).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npx jest arvore-dependencias-layout -v`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Write minimal implementation**

```ts
// mobile/src/lib/arvore-dependencias-layout.ts
import dagre from "dagre";
import type { ArvoreDependenciasResponse } from "./types";

export interface NoLayout {
  codigo: string;
  nome: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface ArestaLayout {
  de: string;
  para: string;
  pontos: { x: number; y: number }[];
}

export interface LayoutArvore {
  nos: NoLayout[];
  arestas: ArestaLayout[];
  largura: number;
  altura: number;
}

const LARGURA_NO = 140;
const ALTURA_NO = 56;

/**
 * dagre é puro JS (sem dependência de DOM/Node) — só calcula posições, quem
 * desenha é o componente SVG. `rankdir: "TB"` = topo→base, mesma direção do
 * grafo lógico (raiz no topo, descendentes abaixo). Um nó com mais de um pai
 * (ex: Mecânica dos Sólidos citada tanto por Cálculo A quanto por Física B)
 * é adicionado uma única vez a `g` — dagre já trata isso como DAG nativo, não
 * como árvore, então o nó não duplica.
 */
export function construirLayout(arvore: ArvoreDependenciasResponse): LayoutArvore {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 56, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const no of arvore.nos) {
    g.setNode(no.codigo, { width: LARGURA_NO, height: ALTURA_NO });
  }
  for (const aresta of arvore.arestas) {
    g.setEdge(aresta.de, aresta.para);
  }

  dagre.layout(g);

  const porCodigo = new Map(arvore.nos.map((n) => [n.codigo, n]));
  const nos: NoLayout[] = g.nodes().map((codigo) => {
    const posicao = g.node(codigo);
    const info = porCodigo.get(codigo)!;
    return {
      codigo,
      nome: info.nome,
      x: posicao.x,
      y: posicao.y,
      largura: LARGURA_NO,
      altura: ALTURA_NO,
    };
  });
  const arestas: ArestaLayout[] = g.edges().map((e) => {
    const edge = g.edge(e);
    return { de: e.v, para: e.w, pontos: edge.points ?? [] };
  });

  const graphInfo = g.graph();
  return {
    nos,
    arestas,
    largura: graphInfo.width ?? 0,
    altura: graphInfo.height ?? 0,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npx jest arvore-dependencias-layout -v`
Expected: PASS. Se `dagre` falhar ao importar em Jest (ex.: erro de módulo CJS/ESM), verificar `transformIgnorePatterns` em `mobile/package.json`/`jest.config` — `dagre` é CommonJS puro, normalmente não precisa de ajuste, mas é o ponto exato onde o risco "dagre em React Native ainda não validado" (ver spec, Open Risks) se resolve nesta task.

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/lib/arvore-dependencias-layout.ts mobile/src/lib/arvore-dependencias-layout.test.ts
git commit -m "feat(mobile): calcula layout do grafo de dependências com dagre"
```

---

### Task 7: Modal com o grafo (SVG + pan/zoom)

**Files:**
- Create: `mobile/src/app/arvore-dependencias.tsx`
- Create: `mobile/src/__tests__/arvore-dependencias.test.tsx`
- Modify: `mobile/src/app/_layout.tsx`

**Interfaces:**
- Consumes: `getArvoreDependencias` (Task 5), `construirLayout` (Task 6), `useAuth` (já existente, expõe `auth.user.curso` quando `auth.status === "signedIn"`).

- [ ] **Step 1: Write the failing test**

Antes de escrever, conferir o padrão de mock de `useLocalSearchParams`/`useAuth`/API já usado em `mobile/src/__tests__/professor-detalhe.test.tsx` (mesma forma de tela: params + fetch + loading/erro) e seguir o mesmo estilo de mock.

```tsx
// mobile/src/__tests__/arvore-dependencias.test.tsx
import { render, screen, waitFor } from "@testing-library/react-native";
import ArvoreDependenciasScreen from "@/app/arvore-dependencias";
import { getArvoreDependencias } from "@/lib/api";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ codigo: "MATA02", nome: "Cálculo A" }),
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ status: "signedIn", user: { curso: "ENGENHARIA/PGCOMP - Salvador" }, accessToken: "token-123" }),
}));

jest.mock("@/lib/api");

describe("ArvoreDependenciasScreen", () => {
  it("mostra loading e depois o grafo", async () => {
    (getArvoreDependencias as jest.Mock).mockResolvedValue({
      nos: [
        { codigo: "MATA02", nome: "Cálculo A", periodo: 1 },
        { codigo: "MATA03", nome: "Cálculo B", periodo: 2 },
      ],
      arestas: [{ de: "MATA02", para: "MATA03" }],
    });

    render(<ArvoreDependenciasScreen />);
    expect(screen.getByTestId("arvore-dependencias-loading")).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-svg")).toBeTruthy());
  });

  it("mostra estado vazio quando a matéria não tem descendentes", async () => {
    (getArvoreDependencias as jest.Mock).mockResolvedValue({
      nos: [{ codigo: "MATA02", nome: "Cálculo A", periodo: 1 }],
      arestas: [],
    });

    render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-vazio")).toBeTruthy());
  });

  it("mostra erro quando a busca falha", async () => {
    (getArvoreDependencias as jest.Mock).mockRejectedValue(new Error("falhou"));

    render(<ArvoreDependenciasScreen />);
    await waitFor(() => expect(screen.getByTestId("arvore-dependencias-erro")).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest arvore-dependencias.test -v`
Expected: FAIL — módulo `@/app/arvore-dependencias` não existe.

- [ ] **Step 3: Write minimal implementation**

```tsx
// mobile/src/app/arvore-dependencias.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { Spinner, Typography, useThemeColor } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";

import { AppIcon } from "@/components/AppIcon";
import { getArvoreDependencias } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { construirLayout, type LayoutArvore } from "@/lib/arvore-dependencias-layout";

type Estado =
  | { status: "loading" }
  | { status: "vazio" }
  | { status: "ready"; layout: LayoutArvore }
  | { status: "erro" };

const ESCALA_MIN = 0.4;
const ESCALA_MAX = 2.5;

export default function ArvoreDependenciasScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { codigo, nome } = useLocalSearchParams<{ codigo: string; nome: string }>();
  const [foregroundColor, dangerColor, mutedColor] = useThemeColor([
    "foreground",
    "danger-foreground",
    "muted",
  ]);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });

  const escala = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (auth.status !== "signedIn" || !auth.user.curso || !codigo) {
      setEstado({ status: "erro" });
      return;
    }
    let ativo = true;
    setEstado({ status: "loading" });
    getArvoreDependencias(auth.accessToken, auth.user.curso, codigo)
      .then((resposta) => {
        if (!ativo) return;
        if (resposta.nos.length <= 1 && resposta.arestas.length === 0) {
          setEstado({ status: "vazio" });
          return;
        }
        setEstado({ status: "ready", layout: construirLayout(resposta) });
      })
      .catch(() => {
        if (ativo) setEstado({ status: "erro" });
      });
    return () => {
      ativo = false;
    };
  }, [auth.status, codigo]);

  const pinch = Gesture.Pinch().onUpdate((e) => {
    escala.value = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, e.scale));
  });
  const pan = Gesture.Pan().onUpdate((e) => {
    translateX.value = e.translationX;
    translateY.value = e.translationY;
  });
  const gesto = Gesture.Simultaneous(pinch, pan);

  const estiloAnimado = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: escala.value },
    ],
  }));

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5"
        style={{ paddingTop: insets.top + 14 }}
      >
        <View className="flex-1 gap-0.5">
          <Typography.Heading type="h4">{nome ?? codigo}</Typography.Heading>
          <Typography.Paragraph type="body-xs" color="muted">
            Matérias que dependem de {codigo}
          </Typography.Paragraph>
        </View>
        <Pressable testID="arvore-dependencias-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center">
        {estado.status === "loading" ? (
          <Spinner testID="arvore-dependencias-loading" />
        ) : estado.status === "erro" ? (
          <Typography.Paragraph testID="arvore-dependencias-erro" color="muted" align="center" className="px-6">
            Não foi possível carregar a árvore de dependências.
          </Typography.Paragraph>
        ) : estado.status === "vazio" ? (
          <Typography.Paragraph testID="arvore-dependencias-vazio" color="muted" align="center" className="px-6">
            Nenhuma matéria depende de {codigo} na grade atual.
          </Typography.Paragraph>
        ) : (
          <GestureDetector gesture={gesto}>
            <Animated.View style={estiloAnimado}>
              <Svg
                testID="arvore-dependencias-svg"
                width={estado.layout.largura}
                height={estado.layout.altura}
              >
                {estado.layout.arestas.map((aresta, i) => {
                  const [primeiro] = aresta.pontos;
                  const ultimo = aresta.pontos[aresta.pontos.length - 1];
                  if (!primeiro || !ultimo) return null;
                  return (
                    <Line
                      key={`${aresta.de}-${aresta.para}-${i}`}
                      x1={primeiro.x}
                      y1={primeiro.y}
                      x2={ultimo.x}
                      y2={ultimo.y}
                      stroke={mutedColor}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {estado.layout.nos.map((no) => (
                  <Rect
                    key={no.codigo}
                    x={no.x - no.largura / 2}
                    y={no.y - no.altura / 2}
                    width={no.largura}
                    height={no.altura}
                    rx={12}
                    fill={no.codigo === codigo ? mutedColor : "transparent"}
                    stroke={mutedColor}
                    strokeWidth={1.5}
                  />
                ))}
                {estado.layout.nos.map((no) => (
                  <SvgText
                    key={`texto-${no.codigo}`}
                    x={no.x}
                    y={no.y}
                    fill={foregroundColor}
                    fontSize={12}
                    textAnchor="middle"
                  >
                    {no.codigo}
                  </SvgText>
                ))}
              </Svg>
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}
```

Registrar a rota como modal:

```tsx
// mobile/src/app/_layout.tsx — dentro do <Stack.Protected guard={auth.status === "signedIn"}>,
// junto às outras Stack.Screen com presentation "modal":
<Stack.Screen name="arvore-dependencias" options={{ presentation: "modal" }} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest arvore-dependencias.test -v`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app/arvore-dependencias.tsx mobile/src/app/_layout.tsx mobile/src/__tests__/arvore-dependencias.test.tsx
git commit -m "feat(mobile): modal com o grafo de dependências (SVG + pan/zoom)"
```

---

### Task 8: Toque no card de matéria abre o modal

**Files:**
- Modify: `mobile/src/app/(tabs)/trajetoria.tsx`
- Modify: `mobile/src/__tests__/trajetoria.test.tsx`

**Interfaces:**
- Consumes: rota `arvore-dependencias` (Task 7).

- [ ] **Step 1: Write the failing test**

Conferir o mock de `expo-router`/`useRouter` já existente em `mobile/src/__tests__/trajetoria.test.tsx` (para reaproveitar o mesmo `router.push` mock) antes de escrever este teste.

```tsx
// mobile/src/__tests__/trajetoria.test.tsx — acrescentar
it("toque num card de matéria cursada abre a árvore de dependências", async () => {
  // ...renderizar a tela com o mesmo setup já usado nos outros testes deste
  // arquivo, garantindo que pelo menos um componente cursado apareça...
  const card = screen.getByText("MATA02"); // ou o testID que a MateriaCard passar a ter
  fireEvent.press(card);
  expect(mockRouterPush).toHaveBeenCalledWith({
    pathname: "/arvore-dependencias",
    params: { codigo: "MATA02", nome: expect.any(String) },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest trajetoria.test -v`
Expected: FAIL — `mockRouterPush` não é chamado (o card ainda não é tocável).

- [ ] **Step 3: Write minimal implementation**

```tsx
// mobile/src/app/(tabs)/trajetoria.tsx
// Import novo no topo:
import { useRouter } from "expo-router";

// Dentro do componente da tela (onde já existe `const auth = useAuth();`), acrescentar:
  const router = useRouter();

// A função MateriaCard (linha ~1047) troca o <View> raiz por <Pressable>:
function MateriaCard({
  componente,
  insight,
  cursados,
  marcos,
  onAbrirArvore,
}: {
  componente: ComponenteCursado;
  insight: Insight;
  cursados: ComponenteCursado[];
  marcos: MarcosSemestralizacao | null;
  onAbrirArvore: (codigo: string, nome: string) => void;
}): JSX.Element {
  // ...corpo inalterado até o return...
  return (
    <Pressable
      testID={`materia-card-${componente.codigo}`}
      onPress={() => onAbrirArvore(componente.codigo, componente.nome)}
      className={`rounded-2xl p-3 justify-between gap-1.5 ${
        naoConta
          ? "bg-surface-secondary/40 border border-dashed border-white/20 opacity-60"
          : "bg-surface-secondary"
      }`}
      style={{ minWidth: 140, flexGrow: 1, flexBasis: 140 }}
    >
      {/* ...conteúdo interno inalterado... */}
    </Pressable>
  );
}

// No local onde <MateriaCard ... /> é renderizado (linha ~1012), passar a prop nova:
<MateriaCard
  key={`${componente.semestre}-${componente.codigo}`}
  componente={componente}
  insight={insight}
  cursados={cursados}
  marcos={marcos}
  onAbrirArvore={(codigo, nome) =>
    router.push({ pathname: "/arvore-dependencias", params: { codigo, nome } })
  }
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest trajetoria.test -v`
Expected: PASS

- [ ] **Step 5: Run the whole mobile suite**

Run: `cd mobile && npm test`
Expected: PASS (nenhuma regressão nos testes existentes de Trajetória/outros)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/app/\(tabs\)/trajetoria.tsx mobile/src/__tests__/trajetoria.test.tsx
git commit -m "feat(mobile): toque no card de matéria abre a árvore de dependências"
```

---

## Self-Review Notes

- **Spec coverage:** extração de códigos + filtro contra a grade (Tasks 1-2), endpoint on-the-fly (Tasks 3-4), layout DAG nó único via `dagre` (Task 6), renderização SVG + pan/zoom (Task 7), trigger no card (Task 8), estados loading/vazio/erro (Task 7) — todas as seções do spec têm task correspondente.
- **Placeholder scan:** nenhum "TBD"/"similar ao anterior" — todo step de código tem o código completo.
- **Type consistency:** `ArvoreDependencias`/`NoArvore`/`ArestaArvore` (backend, Task 2) ecoam exatamente em `ArvoreDependenciasResponse`/`NoArvoreDependencias`/`ArestaArvoreDependencias` (mobile, Task 5) — mesmos campos, nomes adaptados à convenção de cada lado (backend não usa sufixo, mobile usa sufixo por consistência com o restante de `types.ts`, que já sufixa `TrajetoriaResponse`, `ScheduleResponse`). `construirLayout` (Task 6) consome exatamente o formato de `ArvoreDependenciasResponse` produzido por `getArvoreDependencias` (Task 5).
- Task 7's teste assume o mock de `professor-detalhe.test.tsx` como referência de estilo — o worker deve abrir esse arquivo antes de escrever o teste, já que o mock exato de `useAuth`/`expo-router` usado no projeto pode ter nuances (ex.: shape de `AuthProvider`) não capturadas neste plano.
