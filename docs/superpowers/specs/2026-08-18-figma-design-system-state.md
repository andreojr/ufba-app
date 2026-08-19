# Design system no Figma — estado e handoff

Run ID: `gradline-001` · Última atualização: 2026-08-18

Documento de continuação. Uma sessão nova deve ler este arquivo primeiro,
depois carregar as skills `figma-use` e `figma-generate-library` e retomar
do passo indicado em **Onde paramos**.

## Arquivo

| | |
|---|---|
| URL | https://www.figma.com/design/4POhgKwHjaUglgLJ4R5RAI |
| `fileKey` | `4POhgKwHjaUglgLJ4R5RAI` |
| Conta | `luiz.a@ufba.br` (Andre Luiz de Oliveira Junior) |
| `planKey` | `team::1415052565511052985` |
| Tier | `student` — 10 modos por coleção, páginas ilimitadas |

Um arquivo anterior (`7Je2lnk7fxjUPwqNpBEOq6`, conta pessoal antiga) foi
abandonado ainda vazio. Ignorar.

### Páginas

| Página | id | Conteúdo |
|---|---|---|
| Cover | `0:1` | vazia |
| Logo | `5:2` | **do usuário** — não mexer |
| Foundations | `11:2` | board de documentação, root `12:2` |
| `——— COMPONENTS ———` | `11:3` | separador |
| Atoms | `11:4` | Brand/Mark, 21 ícones, Button |
| App shell | `11:5` | vazia |
| Academic | `11:6` | vazia |
| `——— SCREENS ———` | `11:7` | separador |
| Screens | `11:8` | vazia |

## Onde paramos

Concluído: Fase 0 (descoberta), Fase 1 (tokens), Fase 2 (páginas +
Foundations), Fase 3 — Atoms completos (`Icon` ×22, `Button`,
`TextField`, `Chip`, `Avatar`, **`Checkbox`**), `Tabs`, `AppBar`,
`ListGroup Item` e `ListGroup` na página App shell, e página **Screens**
completa com as 4 telas sem dependência de Academic (2026-08-18,
sessão 2).

**Página Screens (`11:8`) — 4 frames 390×844, todos só estado
Default** (usuário optou por não cobrir loading/erro/vazio nesta
sessão — retomar se pedido explicitamente):

| Frame | id | Conteúdo |
|---|---|---|
| `Login` | `89:99` | `Brand/Mark` 96×96 + `Button` (`primary`/`lg`, sem ícone) "Entrar com Google" — spec `2026-08-17-mobile-google-login-design.md` |
| `SIGAA-link` | `90:9` | 2× `TextField` (`Primary`/`Default`: Login do SIGAA, Senha do SIGAA) + `Checkbox` (`State=Default`) + label + `Button` (`primary`/`lg`) "Vincular conta" — spec `2026-08-18-sigaa-link-design.md` |
| `Home` | `90:123` | `AppBar` (`Trailing=Avatar`, título "Início") + placeholder honesto ("Bem-vindo(a) de volta" / "O conteúdo da sua trajetória acadêmica chega em breve.") — conteúdo real não definido em nenhum spec, Academic ainda adiado |
| `Ajustes` | `90:132` | `AppBar` (`Trailing=None`, título "Ajustes") + `ListGroup` (`84:104`, conteúdo real já pronto) |

**Componente novo: `Checkbox`** (`89:50`, página Atoms `11:4`) — não
existia na fila original, foi um gap descoberto ao ler o spec do
SIGAA-link. Modelado a partir de
`mobile/node_modules/heroui-native/src/components/checkbox/`, só
variante `Primary` (a que vale sobre fundo de tela, não sobre card) ×
eixo `State` (`Default`/`Selected`/`Invalid`, o mesmo padrão do
`TextField` — diferenças de cor real, não só opacidade). `Disabled` e
variante `Secondary` não modelados, não usados em nenhum spec ainda.
Selected usa o novo ícone `Icon / check` (`88:47`) com fill sobrescrito
pra `color/accent-foreground` na instância (o componente base do ícone
usa `color/foreground`).

**Ícone novo: `check`** (`88:47`, página Atoms) — 22º ícone, Phosphor
`regular`, baixado direto de
`unpkg.com/@phosphor-icons/core@2/assets/regular/check.svg` (fonte
exata, não de memória). Faltava porque nenhum dos 21 anteriores é um
checkmark simples (`check-circle` é outra coisa).

**Bug pego durante a sessão**: os containers `Form` e `Remember
checkbox` da tela SIGAA-link nasceram com fundo branco atrás do texto
(armadilha #2 de novo — `createAutoLayout()` sem `fills = []`
explícito). Corrigido depois do primeiro screenshot; ambos os
containers precisam de `fills = []` sempre que forem só agrupadores
visuais transparentes.

**Adiado para quando entrar a lógica de negócio** (não iniciar sem o
usuário pedir explicitamente):

- Página **Academic**: `Card`/`OptionCard` (pergunta em aberto — ver
  abaixo), `ClassCell`, `CourseCard`, `TimelineNode`, `DocumentRow`,
  `BottomSheet`.
- Telas **Trajetória** e **Documentos** (dependem dos componentes
  acima).
- **Pergunta pendente sobre `OptionCard`**: o item "Card/OptionCard"
  na fila original não tem definição em nenhum spec. Perguntado ao
  usuário em 2026-08-18, resposta foi "vamos pausar" — retomar essa
  pergunta antes de tocar na página Academic.

## O que existe hoje

**89 variáveis** em 5 coleções, **14 text styles**, **2 effect styles**,
**0 paint styles**. (+6 desde o `Button`: `color/success-soft`,
`color/success-soft-foreground`, `color/warning-soft`,
`color/warning-soft-foreground`, `color/default-soft`,
`color/default-soft-foreground` — precisos pro `Chip`, HeroUI já tinha
essa fórmula em `theme.css` mas só `accent-soft`/`danger-soft` tinham
sido criados na Fase do `Button`.)

| Coleção | Modos | Qtd |
|---|---|---|
| `Color` | Dark, Light | 35 |
| `Primitives` | Value | 30 |
| `Spacing` | Value | 12 |
| `Radius` | Value | 6 |
| `Typography Primitives` | Value | 6 |

Toda semântica de cor aliasa primitivo nos dois modos — zero valor cru.
Toda variável tem scope explícito e code syntax WEB. Validado, não
presumido.

**Componentes**

| Componente | id | Nota |
|---|---|---|
| `Brand / Mark` | `15:13` | capelo duotone 24×24, camada de 20% é o duotone — não achatar |
| `Icon / <nome>` ×22 | `34:4`,`34:7`,`34:10`,`34:13`, `35:4`…`35:52` (passo 3), `88:47` (`check`, sessão 2) | Phosphor regular |
| `Button` (set, 21 variantes) | `39:119` | eixos `Variant` × `Size` |
| `TextField` (set, 6 variantes) | `50:80` | eixos `Variant` (Primary/Secondary) × `State` (Default/Invalid/Disabled); composto de Label row (Label+Asterisk) + Input + Description/FieldError |
| `Chip` (set, 20 variantes) | `59:102` | eixos `Variant` (Primary/Secondary/Tertiary/Soft) × `Color` (Accent/Default/Success/Warning/Danger), size fixo em `md`; `sm`/`lg` documentados como 2 instâncias soltas (`60:56`, `60:58`) |
| `Avatar` (set, 30 variantes) | `64:173` | eixos `Variant` (Default/Soft) × `Color` (Accent/Default/Success/Warning/Danger) × `Size` (sm/md/lg); fallback reusa `Icon / user` via INSTANCE_SWAP-like toggle |
| `Tabs` (set, 2 variantes) | `75:4` (página **App shell**, `11:5`) | eixo `Variant` (Primary segmented/Secondary underline); conteúdo real das 3 abas do app (Início/Trajetória/Documentos) |
| `AppBar` (set, 2 variantes) | `81:65` (página **App shell**, `11:5`) | eixo `Trailing` (None/Avatar); título `Heading/H2`, hairline inferior `color/hairline`; trailing usa instância real do `Avatar` (`Default`/`Accent`/`sm`); `Leading=Back` fora do escopo — falta ícone de seta/caret-esquerda nos 21 disponíveis, entra na fase Screens |
| `ListGroup Item` (set, 4 variantes) | `83:95` (página **App shell**, `11:5`) | eixos `Prefix` (None/Icon 24px) × `Description` (None/Texto); título `Label/md` + `color/foreground`, descrição `Body/Small` + `color/muted`, suffix sempre `Icon/caret-right` 16px em `color/muted` (equivalente ao `ChevronRightIcon` padrão do heroui-native) |
| `ListGroup` (componente único) | `84:104` (página **App shell**, `11:5`) | Surface variant Default (`color/surface`, `radius/3xl`, sem sombra) com conteúdo real da tela de Ajustes — Conta/Editar senha do SIGAA/Sair — separadores `color/separator`; variantes Secondary/Tertiary/Transparent do Surface não modeladas (troca de cor sem variância estrutural) |
| `Checkbox` (set, 3 variantes, sessão 2) | `89:50` (página **Atoms**, `11:4`) | só `Primary`; eixo `State` (Default/Selected/Invalid); fundo `color/field-background`, borda `color/field-border` (1px), selected preenche `color/accent` + `Icon/check` em `color/accent-foreground`, invalid troca borda pra `color/danger` e some com o fundo — modelado de `heroui-native/src/components/checkbox/` |

Ícones disponíveis: `house` `path` `chart-line-up` `file-text` `gear`
`lock-key` `eye` `eye-slash` `cloud-check` `device-mobile` `check-circle`
`clock` `warning-circle` `arrow-square-out` `download-simple`
`caret-right` `caret-down` `identification-card` `user` `spinner`
`dots-six-vertical` `check` (sessão 2).

## Decisões travadas

**Navegação** — 3 tabs de conteúdo (Home, Trajetória, Documentos). Avatar
do Google no header da Home abre tela de Ajustes (conta, editar senha do
SIGAA, sair). Resolve também a falta de logout que o app tem hoje.

**Minha Trajetória** — timeline vertical com marcos por período; as
matérias pendentes vivem numa gaveta (`BottomSheet`) que sobe de baixo, e
o usuário arrasta de lá pro período. Escolhido porque kanban de colunas
não cabe em 390px.

**Cor** — fundo `zinc-900 #18181B` (um degrau mais claro que o
`background` do HeroUI, que é quase preto); cards sobem pra `zinc-800`;
campos *recuam* pra `zinc-900`. Sem drop shadow no dark — o HeroUI define
`surface-shadow: transparent` e separa por clareamento. Única sombra real
é `Elevation/Sheet`, pra gaveta.

**`accent` = `violet/600` (`#7C3AED`)**, não violet-500. Motivo: com
violet-500 o rótulo do botão `primary` dava 4.06:1 e reprovava WCAG AA.
Com violet-600 dá 5.55:1. `violet/500` continua no palette pra decoração.

**`danger` fica no valor de fábrica do HeroUI** (`#DB3B3E`), decisão do
usuário. Contraste 4.35:1 — 0.15 abaixo de AA. É dívida herdada da
biblioteca, não introduzida aqui.

**Status reusa os tokens do HeroUI** (`success #17C964`, `warning
#F7B750`, `danger #DB3B3E`) em vez de emerald/amber/rose inventados, pra
não precisar de override no código. `warning` é a cor mais alta da
paleta — usar só em borda e ícone, nunca preenchendo card.

**Tipografia** — Poppins (sans) + Source Code Pro (mono, só números e
cálculos). Tamanhos mantidos em 16/14/12 em vez de encolher pra compensar
a largura maior da Poppins; só as entrelinhas foram soltas. Os três
estilos `Numeric/*` levam entreletras `-0.05em` porque monoespaçada dá
uma célula inteira pra vírgula e `8,7` lia como `8 , 7`.

**Marca** — o capelo duotone que o usuário forneceu substituiu a arte
antiga (navy + dourado, capelo com escada). O dourado `#F4B942` **não
entra no app** — colidiria com `color/warning`. Mark mono em
`color/foreground`; roxo fica pro CTA.

**Ícones** — Phosphor `regular`, arte buscada de
`@phosphor-icons/core` no unpkg. Escolhido porque o mark do usuário É
Phosphor duotone, então marca e sistema compartilham família. Duotone
para marca, regular para sistema.

## Dívida no código

Nada disso está no app ainda.

- **Fontes:** o app não carrega fonte nenhuma (`expo-font` instalado, zero
  arquivos), então renderiza Roboto do sistema. Precisa de Poppins +
  Source Code Pro via `expo-font` e `fontFamily` no tema do Uniwind.
- **Tokens novos** que não existem no HeroUI e precisam entrar no tema:
  `--color-accent-text`, `--color-scrim`, `--color-hairline`.
- **Overrides de valor** (20 tokens): `--accent` → violet-600, `--background`
  → zinc-900, e a cadeia de surfaces.
- **`--color-accent-soft` a 22%** — o HeroUI calcula 15% via
  `color-mix(in oklab, accent 15%, transparent)`. Os 22% são override
  aprovado pelo usuário; precisa ser explícito no tema, não herdado.
- **Renomeações de tela:** `explore.tsx` vira Trajetória, nasce
  `documentos.tsx` e uma tela de Ajustes.
- **Assets do repo desatualizados:** `design/logo/gradline-icon.svg` e
  `-mono.svg` ainda têm a arte navy+dourada. Os PNGs em
  `mobile/assets/images/` aparecem modificados no git desde o início da
  sessão; não confirmado se batem com o mark novo.
- **Prometido no design, ausente no backend:** notificação de nota
  lançada (o spec `2026-08-18-sigaa-link-design.md` põe push/background
  explicitamente fora de escopo), link autenticado de uso único, PDFs de
  atestado e histórico, e todo o dado da Trajetória — o Prisma não tem
  modelo de currículo nem de pendências.
- **Avatar vai usar DiceBear como fonte de `Avatar.Image`** (decisão do
  usuário, 2026-08-18) — API HTTP pública
  (`https://api.dicebear.com/9.x/{style}/png?seed=...`), sem dependência
  nova no app; seed deve ser identificador estável (matrícula/id do
  Prisma), não o nome. O `Avatar` do Figma (`64:173`) já modela
  `Image`+`Fallback` como o HeroUI espera, então nada muda no design
  system — isso é só conteúdo, entra na integração de código. **Estilo
  do DiceBear ainda não escolhido** (usuário adiou a decisão) — checar a
  licença do estilo escolhido antes de shippar, varia entre CC0 e CC BY
  por estilo.

## Armadilhas que já custaram tempo

Registradas para não se repetirem.

1. **Leia `mobile/node_modules/heroui-native/src/` como fonte da
   verdade**, não a doc do MCP. Foi lá que apareceram o mapeamento
   variante→token do Button, o fato de os botões serem pílula
   (`--radius-3xl` = 24px numa altura de 48px) e as derivações
   `color-mix` dos tokens `-soft`.
2. **`figma.createAutoLayout()` nasce com fundo branco.** 89 containers
   da Foundations ficaram brancos e todo texto quase-branco desapareceu.
   Sempre `fills = []` em container.
3. **O Figma rejeita `.` em nome de variável.** Meio-passos do Tailwind
   viraram `spacing/1-5`, `2-5`, `3-5`, com code syntax mantendo
   `var(--spacing-1.5)`. Nesses três o nome no Figma difere do código.
4. **`letterSpacing.value` volta como float32** (`-0.6000000238418579`).
   Arredondar antes de imprimir em legenda.
5. **O Bash desta máquina é zsh**, não bash — variável não-quotada não
   sofre word splitting, então `for n in $lista` itera uma vez só. Usar
   array `lista=(a b c)`.
6. **`search_design_system` precisa de `includeLibraryKeys`** mesmo para
   biblioteca que está só em `libraries_available_to_add`, e query
   concreta (`home`) funciona onde query vaga (`icon set glyphs`) volta
   vazia.
7. **Screenshot sempre.** A validação estrutural passou limpa enquanto a
   Foundations estava ilegível. Estrutura correta não é aparência
   correta.
8. **Não concluir indisponibilidade a partir de uma busca.** As fontes
   Material estavam instaladas e o plugin do Phosphor estava no arquivo
   enquanto eu afirmava que não havia biblioteca de ícone.
9. **Não modelar como variante o que não é variante na API.** Estados
   pressionado/loading/desabilitado do Button são animação, children e
   prop de opacidade. Cinco tokens tiveram de ser deletados por causa
   disso. (Exceção discutida com o usuário no `TextField`: `isInvalid`/
   `isDisabled` também são boolean props no código, mas mudam cor de
   label/borda e trocam `Description` por `FieldError` — mais que
   opacidade — então viraram eixo `State` de verdade, por decisão do
   usuário via pergunta explícita.)
10. **`figma.createComponentFromNode()` dentro de um `.map()` síncrono
    sobre múltiplos frames corrompe os frames a partir do 3º.** IDs
    liberados pela conversão são reciclados ainda dentro do mesmo
    script, e `combineAsVariants` acaba recebendo nós filhos soltos
    (texto/frame internos) em vez dos componentes esperados — sem
    erro, silenciosamente. Corrigido convertendo **um frame por
    chamada `use_figma`**, validando `width`/`height`/`childCount`
    antes de seguir para o próximo, só então chamando
    `combineAsVariants` numa chamada final.
11. **O bug acima não é do loop em si, é do `.map()` fechando sobre um
    array pré-buscado.** Testado no `Chip` (20 frames): um `for` comum
    que faz `await figma.getNodeByIdAsync(id)` de novo a cada iteração,
    logo antes do `createComponentFromNode`, converteu 8 frames com
    conteúdo real (auto-layout + texto) sem corromper nenhum. Evita
    20 chamadas `use_figma` separadas — uma só, com o padrão certo,
    resolve.
12. **Nem todo cálculo do `theme.css` (`color-mix(in oklab, ...)`) tem
    variável correspondente no Figma.** O `Button` só criou
    `accent-soft`/`danger-soft`; o `Chip` precisou de mais três pares
    (`success`, `warning`, `default`). Variáveis Figma não fazem blend
    ao vivo — os tokens `-soft` guardam a cor base com alpha (ex.
    15%) direto no valor, e os `-soft-foreground` guardam o RGB já
    misturado (mix linear simples, não oklab de verdade — aproximação
    aceitável dado que o Figma Plugin API não expõe oklab).
13a. **Num filho de instância aninhada, `.visible = false` lança
    `Error: get_visible: The node with id "…" does not exist`** —
    achado no `ListGroup` ao tentar esconder o chevron da linha
    "Sair". `.remove()` também falha (`"Removing this node is not
    allowed"` — protegido pela estrutura da instância). `.opacity = 0`
    funciona e é o caminho certo para esconder conteúdo dentro de uma
    instância sem quebrar a referência ao componente principal.
13. **`figma.variables.setBoundVariableForPaint()` pode "esquecer" de
    resolver a cor pro valor real, silenciosamente, sem erro nenhum —
    achado no `Avatar`.** Os 30 componentes renderizaram sólido preto
    ou branco (o RGB placeholder `{r:1,g:1,b:1}` cru) mesmo com
    `boundVariables` apontando pro ID certo — `get_variable_defs`
    inclusive reportava o hex correto, então o binding em si estava
    íntegro, só o RENDER (`node.screenshot()` e `get_screenshot`) que
    pintava o valor bruto. Só aconteceu em nós que passaram por
    `clone()` → `resize()` → `createComponentFromNode()` →
    `combineAsVariants()` → reatribuição de fill num loop; nós recém
    criados com o mesmo helper resolveram certo. Recontei `Button`,
    `Chip` e `TextField` depois — os três continuam corretos, então
    não é sistêmico, mas é silencioso o bastante pra nunca confiar só
    em `get_variable_defs` ou no JSON de `node.fills` como prova de
    que o VISUAL está certo. **Mitigação**: nunca usar
    `{r:1,g:1,b:1}` como placeholder ao vincular uma variável de cor —
    montar o paint com o RGB literal já resolvido (walk manual da
    cadeia de alias pro modo Dark) + `boundVariables`, e sempre
    confirmar com `get_screenshot`, nunca só com metadata.

## Prompt de continuação

> Estou continuando o design system do Gradline no Figma. Run ID
> `gradline-001`, arquivo `4POhgKwHjaUglgLJ4R5RAI`. Leia
> `docs/superpowers/specs/2026-08-18-figma-design-system-state.md`,
> carregue as skills `figma-use`, `figma-generate-library` e
> `figma-generate-design`, e retome pela página Academic (currículo,
> pendências, timeline) — só quando eu pedir explicitamente; a página
> Screens (Login, SIGAA-link, Home, Ajustes) já está completa.
