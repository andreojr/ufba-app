# Vizinhos curriculares (substitui o grafo por navegação em cascata) — design spec

## Motivation

Substitui por completo a abordagem da entrega anterior
(`docs/superpowers/specs/2026-08-20-arvore-dependencias-design.md`): um modal
com um grafo visual (DAG completo de descendentes, layout via `dagre`,
desenhado em `react-native-svg` com pan/zoom). Essa abordagem gerou três
crashes reais em produção, cada um raiz diferente — Metro incapaz de
empacotar `dagre`/`graphlib`, `<Marker orient="auto-start-reverse">` não
suportado no Android, e um `<Svg>` no tamanho lógico do grafo estourando o
limite de bitmap do `Canvas` do Android para matérias-base com muitos
descendentes (ex. Cálculo A: 3978×1784dp → ~215MB de bitmap). Historiado em
detalhe nos commits `2f2aac1`, `7d8e759`, `8f24163`.

Em vez de continuar corrigindo uma arquitetura de renderização
estruturalmente pesada pro que ela precisa fazer, a nova abordagem troca o
grafo transitivo inteiro por uma navegação em cascata: cada tela mostra só
a **matéria atual**, seus **pré-requisitos diretos** (um nível acima) e o
que ela **desbloqueia diretamente** (um nível abaixo), como uma sequência —
"é isso, aí depois isso, e por fim isso" — com a mesma linguagem visual de
pontinho + linha vertical que a tela de Trajetória já usa (`LinhaDoTempo`).
Tocar num card de qualquer um dos dois blocos empurra uma tela nova,
recentrada naquela matéria — o "grafo completo" emerge da navegação, nunca
precisa ser calculado ou desenhado de uma vez.

Isso elimina inteiramente `dagre`, `react-native-svg` (nessa tela),
gesture-handler/pan-zoom, e o BFS transitivo do backend — junto com todo o
espaço de bugs que essas peças abriram.

## Scope

**Nesta entrega:**

- Endpoint novo que devolve, pra uma matéria, seus pré-requisitos diretos e
  o que ela desbloqueia diretamente, cada um com uma **situação** calculada
  pra o aluno autenticado: `cursada` (aprovada), `emCurso` (matriculado
  agora), `liberada` (não cursada, pré-requisitos satisfeitos) ou
  `bloqueada` (não cursada, pré-requisitos não satisfeitos).
- Um parser booleano real de pré-requisito (E/OU/parênteses), pra avaliar
  satisfação de pré-requisito corretamente — diferente da entrega anterior,
  que deliberadamente ignorava essa lógica pra fins só visuais. Aqui importa
  de verdade: um cadeado errado engana o aluno sobre o que ele pode cursar.
- Tela mobile nova (substitui o modal antigo) com a matéria atual em
  destaque, pontinho+linha conectando pré-requisito → atual → desbloqueia
  (mesmo vocabulário visual do `LinhaDoTempo` da Trajetória), navegação por
  push (cada toque empilha uma tela nova, botão voltar nativo desfaz um
  nível).
- Remoção de tudo que só existia pro grafo antigo: `dagre`,
  `@types/dagre`, o patch do `graphlib`, `arvore-dependencias-layout.ts`,
  `pan-zoom.ts`, o BFS transitivo (`construirArvoreDependencias`) e toda a
  renderização SVG/gesture da tela antiga.

**Fora de escopo, deliberadamente:**

- **Grafo completo/transitivo em uma tela só.** A visão "de tudo" emerge da
  navegação em cascata, nunca é computada de uma vez — decisão explícita
  pra evitar reintroduzir o espaço de bugs de renderização de grafo grande.
- **Direção "o que preciso pra cursar X" em profundidade.** Só um nível pra
  cada lado por tela — profundidade maior é só navegação, não dado extra
  buscado de uma vez.
- **Persistir/cachear a situação calculada.** Recalculada a cada requisição
  a partir do histórico já persistido — não é caro (é local, sem I/O de
  rede), não precisa de cache próprio.
- **Resolver `User.curso` no servidor.** Mesma decisão já registrada no
  catálogo de currículo — o mobile continua mandando `curso` como query
  param.

## Data model

Reaproveita por completo o modelo já existente
(`Curso`/`EstruturaCurricular`/`ComponenteCurricular`, ver spec do catálogo)
e o histórico já persistido (`Historico`/`HistoricoComponente`, no módulo
`sigaa-engine`). Nenhuma tabela nova.

## Avaliador booleano de pré-requisito

`preRequisito` continua texto cru (`"(FISD36 E FISD42) OU (ENGJ18)"`). Um
parser recursivo-descendente pequeno (tokens: códigos, `E`, `OU`, `(`, `)`;
`E` tem precedência sobre `OU`) constrói uma árvore de expressão booleana e
a avalia contra o conjunto de códigos com situação `APR` (aprovado) no
histórico do aluno. Ausência de pré-requisito avalia `true` trivialmente.
Um código citado que não existe na grade ativa (mesma regra de filtro já
usada na entrega anterior) é tratado como não-satisfeito na avaliação — não
descartado silenciosamente como era pro grafo, porque aqui a ausência
afeta o resultado da avaliação, não só a lista de nós exibidos.

Módulo novo e isolado em `backend/src/curriculo/`, sem reaproveitar/misturar
com `extrairCodigosCitados` (que continua existindo, ainda usado — mas
ignora deliberadamente a estrutura E/OU; o parser booleano novo é o inverso,
existe justamente pra entender essa estrutura).

### Cálculo de situação

Pra cada componente mostrado (matéria atual, cada pré-requisito, cada
"desbloqueia"):

1. Situação no histórico é `APR` → `cursada`.
2. Situação no histórico é `MATR` → `emCurso`.
3. Senão, avalia a expressão booleana do `preRequisito` daquele componente
   contra o conjunto de códigos `APR` do histórico → `liberada` se `true`
   (ou sem pré-requisito), `bloqueada` se `false`.

Sem histórico persistido pro usuário (nunca sincronizou): todo componente
vira `bloqueada` por padrão — nunca inventa `cursada`/`liberada` sem dado
real, mas a resposta ainda é montada normalmente, não é erro.

## Backend architecture

Extensão do módulo `curriculo/` existente:

- `avaliador-prerequisito.ts` — módulo puro novo: parser recursivo-descendente
  (tokenizador + parser + avaliador), testável com fixtures de texto real do
  catálogo (E, OU, parênteses aninhados, combinações).
- `vizinhos-curriculares.ts` — módulo puro novo: dado um componente raiz e a
  lista de componentes da estrutura + o conjunto de códigos `APR`/`MATR` do
  histórico, monta `{ atual, preRequisitos: [...], desbloqueia: [...] }`
  com a situação calculada de cada um (reaproveita `extrairCodigosCitados`
  pra achar quem cita a raiz — mesmo índice reverso da entrega anterior,
  só que sem BFS: um nível só).
- `curriculo.service.ts` — novo método `vizinhosCurriculares(cursoId,
  codigo, userId)` (e o par `PorNomeUsuario`, mesma convenção dos métodos
  já existentes) que busca a estrutura ativa (via `resolverCurso`/
  `resolverPorNomeUsuario`, já existentes) e o histórico persistido
  (`HistoricoRepository.buscar(userId)`, do módulo `sigaa-engine`, já
  importado pelo módulo `curriculo` por outro motivo), e delega a
  `vizinhos-curriculares.ts`.
- `curriculo.controller.ts` — rota nova:

  **`GET /curriculo/meu-curso/componentes/:codigo/vizinhos?curso=<nome>`**
  — usa `request.user.userId` (JWT) pra buscar o histórico; `curso` como
  query param, mesma convenção do resto do módulo. Substitui a rota antiga
  (`arvore-dependencias`) — nada além desta feature a consumia.

  Resposta:
  ```json
  {
    "atual": { "codigo": "MATA03", "nome": "Cálculo B", "situacao": "emCurso" },
    "preRequisitos": [{ "codigo": "MATA02", "nome": "Cálculo A", "situacao": "cursada" }],
    "desbloqueia": [
      { "codigo": "MATA04", "nome": "Cálculo C", "situacao": "bloqueada" },
      { "codigo": "ENGC30", "nome": "Mecânica dos Sólidos", "situacao": "liberada" }
    ]
  }
  ```

  404 (`ComponenteDesconhecidoError`/`CursoDesconhecidoError`, já
  existentes) quando `:codigo` ou `curso` não resolvem — mesmo tratamento
  de antes na tela (distinguir os dois pela mensagem citar ou não o código,
  já corrigido na entrega anterior e reaproveitado aqui).

**Removido:** `arvore-dependencias.ts` (BFS transitivo) e a rota
`GET .../arvore-dependencias`.

## Mobile architecture

- Tela nova (substitui `arvore-dependencias.tsx`): busca
  `getVizinhosCurriculares` ao montar; loading/vazio (não deveria acontecer
  nesse desenho — sempre há ao menos a matéria atual — mas erro de rede
  ainda cai em erro)/erro com retry, mesmo padrão já estabelecido.
- Layout "Linha do tempo": pontinho + linha vertical (mesmo `w-2.5 h-2.5
  rounded-full` + linha de 1-2px do `LinhaDoTempo` da Trajetória),
  conectando o bloco "Pré-requisito" (se houver — pode ser vazio, ex.
  matéria de período 1) → card da matéria atual em destaque (borda
  accent, ponto maior com halo) → bloco "Desbloqueia" (pode ser vazio, ex.
  última matéria do curso). Cor do ponto/ícone de cada card codifica a
  situação: preenchido (cursada), aberto sólido (liberada), aberto
  pontilhado + opacidade reduzida (bloqueada), ponto especial +
  `useThemeColor("accent")` (emCurso) — mesma paleta success/accent/muted
  já usada em `MateriaCard`/`LinhaDoTempo`.
- Tocar num card de qualquer bloco: `router.push` pra essa mesma tela, com
  o `codigo`/`nome` do card tocado — empilha uma tela nova, recentrada.
  Botão voltar nativo desfaz um nível.
- Trigger de entrada: idêntico a antes — toque no `MateriaCard` da
  Trajetória (`onAbrirArvore` renomeado pra refletir o novo destino, mas a
  mesma wiring).

**Removido:** `dagre`, `@types/dagre`, `mobile/patches/graphlib+2.1.8.patch`
(+ o `postinstall` que o aplicava), `arvore-dependencias-layout.ts` (+
teste), `pan-zoom.ts` (+ teste), toda a renderização SVG/Marker/Polyline e
gesture-handler pan-zoom da tela antiga.

## Testing

TDD, na ordem em que as peças são construídas.

**Backend:**

- `avaliador-prerequisito.ts` — fixtures de texto reais do catálogo: só E,
  só OU, parênteses aninhados, combinações, código citado ausente da
  grade (deve contar como não-satisfeito), sem pré-requisito.
- `vizinhos-curriculares.ts` — componentes fake cobrindo os 4 estados de
  situação (cursada/emCurso/liberada/bloqueada), matéria sem
  pré-requisito (período 1), matéria sem quem desbloqueia (última do
  curso), aluno sem histórico persistido (tudo bloqueada por padrão).
- `curriculo.service.ts`/`curriculo.controller.ts` — mesma convenção já
  estabelecida no módulo (repositório fake, supertest, guard de
  autenticação).

**Mobile:**

- Tela nova — loading/erro/dados, incluindo pré-requisitos vazio e
  desbloqueia vazio como casos distintos (não um único "vazio" combinado).
- Navegação: tocar num card do bloco dispara `router.push` com o
  `codigo`/`nome` certos.

Nenhum teste bate no SIGAA real — tudo lê dados já persistidos (catálogo de
currículo + histórico).

## Open risks

1. **Parser booleano é novo e crítico pra correção, não só pra exibição.**
   Um bug aqui mostra cadeado errado (bloqueia uma matéria liberada, ou
   vice-versa) — pior que um bug visual no grafo antigo. Vale um conjunto
   de fixtures generoso, cobrindo combinações reais do catálogo (não só
   casos sintéticos), antes de confiar no resultado.
2. **Situação sem histórico sincronizado.** Um aluno que nunca sincronizou
   vê tudo como `bloqueada` — tecnicamente correto (não temos dado pra
   dizer o contrário), mas pode ler como "nada liberado" de forma confusa
   se ele não entender por que. Vale considerar, fora desta entrega, uma
   mensagem explicando a ausência de histórico nesse caso específico.
