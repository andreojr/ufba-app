# Design: mover matéria projetada por arrastar no grid de semestres

Data: 2026-08-26

## Contexto

Hoje, na tela de Trajetória (`mobile/src/screens/TrajetoriaTab.tsx`), cada
matéria projetada (`CardProjetado`) tem um botão de calendário que abre um
menu (`heroui-native` `Menu`) listando os semestres futuros já existentes na
projeção, como destinos possíveis pra mover a matéria. A lista de "semestres
futuros" vem inteiramente do que o backend já projetou
(`projecao.semestres`) — não existe noção de "criar um novo semestre" nem de
"este semestre deixou de ter matérias".

O algoritmo de projeção (`backend/src/curriculo/projetor.ts`,
`backend/src/curriculo/projecao-trajetoria.ts`) já pode gerar, hoje, um
semestre "vazio" no meio da linha do tempo: se o aluno fixa (via
`putPlano`/override) uma matéria pra um semestre bem distante e não sobra
mais nada pendente pra preencher os semestres intermediários, o laço de
`alocar` ainda os percorre e empurra `SemestreProjetado`s com
`componentes: []` até alcançar o override distante. Isso nunca foi tratado
explicitamente — é a mesma situação que a nova regra de UX resolve.

## Objetivo

1. Trocar o menu de calendário por um gesto de segurar-e-arrastar: ao dar
   long-press num `CardProjetado`, abre um overlay full-screen com um grid
   de quadradinhos — um por semestre futuro já projetado, mais um
   quadradinho pontilhado extra pra criar o próximo semestre além do que já
   existe. Soltar o card sobre um quadradinho move a matéria pra aquele
   semestre.
2. Garantir que a lista de semestres futuros nunca mostra um semestre vazio
   no meio: se a última matéria de um semestre sai dele (por override) e ele
   não é o último da projeção, esse semestre deixa de existir e os
   semestres seguintes são renumerados (deslocados em -1 período). Se for o
   último, ele simplesmente some.

## Fora de escopo

- Mudar como matérias já cursadas são exibidas (`MateriaCard` continua sem
  botão de mover).
- Mudar o algoritmo de alocação automática em si (`alocar`'s greedy
  scheduling) — só o pós-processamento que evita semestre vazio.
- Otimismo local no client durante o drag (permanece "no local optimism":
  o PUT + refetch decide o resultado real, igual hoje).
- Selecionar optativas/complementares (assunto de outro spec, já citado no
  código como trabalho futuro).

## Arquitetura

### Mobile — grid de arrastar

Novo componente `SemestreDragGrid`, montado condicionalmente dentro de
`TrajetoriaTab`/`ReadyTrajetoria` via um estado local
`arrastando: ComponenteProjetado | null`.

- `CardProjetado` troca o `Menu.Trigger` (ícone `IconCalendarBlank`) por um
  `GestureDetector` combinando `Gesture.LongPress()` e `Gesture.Pan()`
  (`react-native-gesture-handler`, já é dependência do projeto). Ao
  reconhecer o long-press, o card entra em modo "arrastando": uma
  `Animated.View` (`react-native-reanimated`, já dependência) segue o dedo
  via `useAnimatedStyle` sobre `translationX/Y` do pan, e o overlay sobe.
- Overlay: fundo escurecido, cobrindo a tela inteira (`position: absolute`,
  zIndex alto — ou `Modal` nativo, a decidir na implementação conforme o que
  já existe de precedente no projeto para overlays). Contém um grid com:
  - um quadradinho por `projecao.semestres` (mesma fonte de hoje —
    `semestresProjetados`), mostrando o identificador do semestre
    (`"2027.1"`), desabilitado/visualmente distinto para o semestre atual do
    card sendo arrastado (equivalente ao filtro `destinos` de hoje);
  - **um quadradinho extra pontilhado**, sempre por último, representando
    `proximoSemestre(ultimoSemestreProjetado)` — soltar aqui cria esse
    semestre (na prática: o override aponta pra um semestre que ainda não
    existia na projeção, e ele passa a existir por ter uma matéria).
- Hit-test: cada quadradinho registra seu retângulo via `onLayout`; ao
  soltar (`onEnd` do gesto de pan), calculamos qual quadradinho contém o
  ponto de soltura com uma função pura testável isoladamente, ex.
  `quadradinhoNoPonto(retangulos: Rect[], ponto: {x:number,y:number}): number | null`.
- Soltura válida → chama a mesma função `onMover(componente, destino)` que
  já existe hoje (`moverComponente`, em `TrajetoriaTab.tsx`), preservando o
  comportamento de "no local optimism": PUT `/trajetoria/plano` e
  substituição integral do state pela resposta. O overlay fecha com uma
  animação de saída; enquanto o PUT está em voo, o card mostra um indicador
  de carregamento (reaproveitar padrão existente, se houver; senão, um
  estado simples `movendo: string | null` por código).
- Soltura fora de qualquer quadradinho, ou gesto cancelado: overlay fecha
  sem chamar nada, card volta ao lugar (sem alteração de estado).
- O botão "Tirar do plano" (mover para `null`, hoje um item de menu extra
  quando `componente.manual`) precisa de um lugar no novo fluxo — vira uma
  área/quadradinho distinto no overlay (ex. "Remover do plano manual"),
  visível só quando `componente.manual` for `true`.

### Backend — compactação de semestres vazios

Nova função pura, ex. `compactarSemestres` em
`backend/src/curriculo/projetor.ts`:

```ts
function compactarSemestres(
  semestres: SemestreProjetado[],
  primeiro: string,
): SemestreProjetado[]
```

- Remove da lista qualquer `SemestreProjetado` com `componentes.length === 0`
  (nunca é exibido nem contado).
- Renumera sequencialmente os que sobraram, encadeando `proximoSemestre` a
  partir de `primeiro` — a ordem relativa entre eles não muda, só os
  identificadores de calendário são reatribuídos pra fechar o buraco
  deixado pelos removidos.

Chamada em `montarProjecao` (`projecao-trajetoria.ts`) logo após `alocar` e
**antes** de `derramarHorasGenericas`, já que essa função depende do
`.semestre` do último item da lista pra continuar a sequência corretamente.

`conclusaoProjetada`, `semestresAlemDoPrevisto` e `alemDoPrazoMaximo`
continuam calculados como hoje, só que sobre a lista já compactada.

**Compatibilidade com overrides existentes**: nada muda no formato de
`ItemPlano`/`fixos`. Um override guarda o identificador de semestre que o
usuário escolheu no momento do PUT. Depois de uma compactação futura
renomear os semestres, overrides antigos continuam funcionando sem
migração porque `alocar` já compara com `compararSemestres(fixo, semestre)
<= 0` — um override "vencido" (aponta pra um semestre que a nova numeração
já ultrapassou) é alocado assim que o laço o alcança, do mesmo jeito que já
trata hoje um override cujo semestre ficou no passado.

## Fluxo de dados (ponta a ponta)

1. Usuário segura o card → overlay abre com os quadradinhos calculados a
   partir da `projecao` já carregada no client (nenhuma chamada nova).
2. Usuário solta sobre um quadradinho → `onMover` chama `putPlano` com o
   mesmo formato de hoje (`{ codigo, nome, cargaHoraria, semestre }`).
3. Backend persiste o override (`historicoService.salvarPlano`, inalterado)
   e recalcula a trajetória inteira via `this.get(user)`.
4. `montarProjecao` roda `alocar` → `compactarSemestres` → 
   `derramarHorasGenericas`, devolvendo uma lista de semestres sem nenhum
   vazio no meio.
5. Client substitui o state inteiro pela resposta (sem otimismo), timeline
   re-renderiza com a nova distribuição — inclusive um possível
   deslocamento visual de semestres que o usuário nem tocou diretamente.

## Erros

- Falha de rede no PUT: mesmo tratamento que existe hoje em
  `moverComponente` (a implementação vai confirmar se já existe
  toast/feedback de erro; se não houver, é um ajuste pequeno incluído aqui,
  não um novo requisito).
- Gesto cancelado/solto fora de área válida: sem chamada de rede, sem
  mudança de estado.

## Testes

**Backend** (`projecao-trajetoria.test.ts` ou equivalente):
- Override distante o bastante pra gerar semestres vazios intermediários →
  `compactarSemestres` remove e renumera corretamente.
- Múltiplos gaps não-contíguos.
- Um gap seguido de outro override que deve "pousar" no semestre já
  renomeado (não no identificador antigo).
- Remover a última matéria de um semestre do meio → semestre desaparece,
  seguintes deslocam -1.
- Remover a última matéria do último semestre → semestre simplesmente some,
  sem deslocamento de nada (não há "seguintes").

**Mobile**:
- `quadradinhoNoPonto` (função pura de hit-test) testada isoladamente com
  vários retângulos/pontos.
- `CardProjetado`/`TrajetoriaTab`: long-press abre o grid; grid lista os
  semestres da projeção + 1 quadradinho pontilhado; soltar sobre um
  quadradinho chama `onMover` com o destino certo; soltar fora fecha sem
  side-effect; quadradinho do semestre atual do card aparece desabilitado.

## Riscos / pontos em aberto pra revisão durante a implementação

- Testar gesture-handler com RTL pode exigir simular eventos de baixo nível
  (`fireGestureHandler` ou equivalente) — a cobertura de integração pode
  ficar mais fina que a lógica pura, compensada pelos testes de
  `quadradinhoNoPonto` isolados.
- Confirmar se já existe um padrão de overlay/modal full-screen em outro
  lugar do app pra reaproveitar (evitar inventar um segundo mecanismo).
