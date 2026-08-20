# Árvore de dependências (grafo por matéria) — design spec

## Motivation

Na tela de Trajetória, cada card de matéria é hoje só informativo (nome,
período, status). Falta uma forma de visualizar **o impacto** de uma
matéria no resto do curso: quais matérias dependem dela, direta ou
transitivamente, via pré-requisito.

Esta entrega adiciona: tocar no card de uma matéria abre um modal com um
grafo visual mostrando a árvore de **descendentes** daquela matéria — as
matérias que a têm como pré-requisito, as que dependem dessas, e assim por
diante, até esgotar a cadeia. Puramente informativo (v1): nenhuma ação ao
tocar num nó do grafo.

Depende do catálogo de currículo (`docs/superpowers/specs/2026-08-20-catalogo-curriculo-design.md`)
já persistir `ComponenteCurricular.preRequisito` como texto cru — este
spec assume que aquela entrega já está em produção.

## Scope

**Nesta entrega:**

- Parser que extrai códigos de disciplina citados em `preRequisito`,
  ignorando a estrutura lógica E/OU (uma aresta "X é pré-requisito citado
  de Y", sem diferenciar obrigatório de alternativo).
- Endpoint novo que devolve o grafo (nós + arestas) de todos os
  descendentes de um componente, a partir da estrutura curricular ativa
  já persistida.
- Modal no mobile com o grafo renderizado como DAG real (nó único por
  matéria, mesmo que tenha múltiplos pais), com pan/zoom.

**Fora de escopo, deliberadamente:**

- **Direção inversa** (o que preciso cursar antes de X — ancestrais).
  Only descendentes nesta entrega; a mesma infraestrutura de índice serve
  para isso depois, se algum roadmap item pedir.
- **Fidelidade à lógica E/OU.** O grafo não distingue "precisa de A e B"
  de "precisa de A ou B" — toda referência citada vira aresta igual. Se
  algum dia isso importar visualmente, é um parser booleano estruturado
  novo, não uma extensão barata deste.
- **Ação ao tocar num nó** (navegar, abrir detalhe). V1 é só visual.
- **Limite de profundidade/tamanho do grafo.** Mostra a árvore completa de
  descendentes, sem corte; pan/zoom é a resposta para grafos grandes.
- **Reconciliação de currículo do aluno.** O grafo é sempre relativo à
  estrutura curricular **ativa** do curso (mesmo recorte que o catálogo já
  usa), não à grade específica em que o aluno se matriculou.

## Data flow

```
ComponenteCurricular[] (estrutura ativa, já persistida)
        │
        ▼
extrairCodigosCitados(preRequisito) ──▶ filtra contra códigos existentes na mesma estrutura
        │
        ▼
índice reverso: codigo → [códigos que o citam]
        │
        ▼
BFS a partir do código raiz ──▶ { nós[], arestas[] }
        │
        ▼
GET /curriculo/cursos/:cursoId/componentes/:codigo/arvore-dependencias
        │
        ▼
mobile: monta input do dagre ──▶ layout (x, y por nó, pontos de aresta)
        │
        ▼
react-native-svg desenha nós/arestas, pan/zoom via gesture-handler + reanimated
```

### Extração de códigos e filtro contra a grade

`preRequisito` é texto cru, ex. `"(FISD36 E FISD42) OU (ENGJ18)"`. A
extração usa regex sobre o padrão de código de componente (mesmo formato
já usado em `codigo` de `ComponenteCurricular`) e ignora inteiramente E/OU
e parênteses — produz uma lista plana de códigos citados.

**Um código citado só vira aresta se existir como `codigo` de algum outro
`ComponenteCurricular` da mesma `EstruturaCurricular`.** Código que não
bate com nenhum componente da grade ativa (referência a currículo antigo,
outro curso, ou optativa fora da matriz) é descartado silenciosamente —
não é um erro, é esperado. Sem isso, o grafo teria nós "fantasma" sem
nome, carga horária ou período.

### Índice reverso e BFS

A partir da lista de `(citado, citante)` já filtrada, monta-se
`codigo → [códigos que o citam]`. Dado o código raiz clicado, um BFS
coleta todos os alcançáveis nesse índice, com set de visitados (proteção
contra ciclo, não esperado num currículo real mas tratado por segurança).

Resultado: lista de nós (`{codigo, nome, periodo}`) e lista de arestas
(`{de, para}`, onde `para` depende de `de`) — o DAG completo de
descendentes, achatado (sem aninhamento), porque o layout de nó único
compartilhado é responsabilidade do mobile (dagre), não do backend.

## Backend architecture

Extensão do módulo `curriculo/` existente:

- `arvore-dependencias.ts` — módulo puro: `extrairCodigosCitados`,
  filtro contra componentes da estrutura, montagem do índice reverso,
  BFS. Sem I/O, testável só com fixtures de texto e um grafo pequeno
  controlado.
- `curriculo.service.ts` — novo método que busca a estrutura ativa já
  persistida (reaproveita o que `resolverCurso` já resolve) e delega a
  `arvore-dependencias.ts`.
- `curriculo.controller.ts` — nova rota:

  **`GET /curriculo/cursos/:cursoId/componentes/:codigo/arvore-dependencias`**
  — devolve `{ nos: [...], arestas: [...] }`. 404 se `cursoId` ou
  `codigo` não existem na estrutura ativa persistida. Não dispara
  scraping ao vivo — só lê dados já resolvidos (se a estrutura nunca foi
  resolvida, mesmo 404/erro dos outros endpoints do módulo já cobre
  isso).

JWT-guarded, mesma convenção do resto do módulo.

## Mobile architecture

- Trigger: tocar no card de matéria em `trajetoria.tsx` abre um modal
  novo, seguindo o padrão de modal já usado no app.
- Busca o grafo no endpoint novo ao abrir; estados de loading / vazio
  (matéria sem descendentes, ex. TCC) / erro (com retry), seguindo o
  padrão visual já usado em outras telas do app.
- Função pura (`mobile/src/lib/arvore-dependencias.ts` ou similar) que
  recebe `{ nos, arestas }` e monta o input do `dagre` — separada do
  componente visual, testável sem renderizar SVG.
- `dagre` (nova dependência no `mobile/package.json`) calcula posição
  (x, y) de cada nó e os pontos de cada aresta — layout em camadas
  (Sugiyama), nó único por matéria mesmo com múltiplos pais.
- `react-native-svg` (já no projeto) desenha nós (retângulo + texto) e
  arestas (paths) a partir do layout do dagre.
- Pan/zoom via `react-native-gesture-handler` + `react-native-reanimated`
  (ambos já no projeto) — pinça pra zoom, arraste pra pan.
- Tocar num nó: sem ação (v1), talvez destaque visual das arestas
  conectadas como bônus, sem virar navegação.

## Testing

TDD, na ordem em que as peças são construídas.

**Backend:**

- `arvore-dependencias.ts` — fixtures de texto variadas: só E, só OU,
  parênteses aninhados, código citado que não existe na grade (deve ser
  descartado), sem pré-requisito. BFS testado com grafo pequeno
  controlado, incluindo nó com múltiplos pais e proteção contra ciclo.
- `curriculo.service.ts` — repositório fake: estrutura sem o componente
  pedido (404), componente sem nenhum descendente (grafo vazio).
- Controller — supertest, guard de autenticação incluído.

**Mobile:**

- Função pura de montagem do input do `dagre` — testável sem SVG.
- Modal — cobre loading / vazio / erro com fake do endpoint.

Nenhum teste bate no SIGAA real (esta entrega não faz scraping — só lê
dados já persistidos pelo catálogo de currículo).

## Open risks

1. **`dagre` em React Native** ainda não foi validado na prática neste
   projeto — é pura JS sem dependência de DOM, mas vale um spike rápido
   de integração antes de comprometer o layout do modal a ela.
2. **Grafos grandes sem limite de profundidade** (decisão desta entrega)
   podem ficar pesados de renderizar para matérias-base do curso (ex.
   Cálculo A). Pan/zoom é a resposta atual; se a performance não for
   aceitável na prática, revisitar como possível limite de profundidade
   ou virtualização, mas não implementado preventivamente agora.
