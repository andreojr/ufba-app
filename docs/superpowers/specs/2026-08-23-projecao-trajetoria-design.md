# Projeção da trajetória — design spec

## Motivation

A Trajetória foi construída quando a única fonte era o histórico do aluno.
O planejador que ela ganhou reflete essa limitação: oferece **dois
semestres futuros arbitrários** (`ZONAS_FUTURAS = 2`) e despeja todas as
obrigatórias pendentes num balde `"Sem período"`, porque não havia de onde
inferir quando cada uma deveria ser cursada.

Isso mudou. O item 3 do roadmap catalogou as estruturas curriculares, e
`ComponenteCurricular.periodo` diz em que período da grade cada obrigatória
mora. O `TrajetoriaController` **já resolve a estrutura ativa do aluno** ao
montar os marcos de semestralização — o dado está na mão do endpoint e
simplesmente não é usado para isso.

Com ele, a linha do tempo deixa de parar no presente: as matérias que
faltam nascem alocadas nos semestres em que o aluno vai cursá-las, a
projeção segue até a fila esvaziar, e a linha de chegada passa a marcar um
semestre concreto em vez de ser um enfeite no fim da lista.

## Scope

**Nesta entrega:**

- Um projetor puro no backend que distribui as obrigatórias pendentes pelos
  semestres futuros, respeitando pré-requisito e um teto de carga horária.
- Extensão do payload de `GET /trajetoria` com a projeção pronta.
- `PUT /trajetoria/plano` para persistir os ajustes manuais do aluno, que
  hoje só existem em memória (`movimentos`, em `TrajetoriaTab`).
- A tela de Trajetória passando a desenhar passado e futuro na mesma linha
  do tempo, sem zonas de planejamento nem balde "Sem período".

**Fora de escopo, deliberadamente:**

- **Seleção de optativas** (item A do roadmap). Aqui elas entram só como
  horas genéricas; a tela de escolha é a entrega seguinte.
- **Oferta real de disciplina.** Não sabemos se uma matéria só abre em
  semestre ímpar — o catálogo não guarda isso. A projeção assume que
  qualquer matéria pode ser cursada em qualquer semestre.
- **Resolver a estrutura curricular exata do aluno.** Continua valendo o
  que o catálogo decidiu: comparamos sempre contra a Ativa.
- **Reprojetar ao mover um card.** Mover é override puro (ver
  "Overrides").

## Decisões tomadas

Registradas aqui porque cada uma foi uma bifurcação real da conversa de
design, e o código sozinho não explica por que o outro caminho foi
recusado.

| Decisão | Escolha | Alternativa recusada |
|---|---|---|
| Eixo do futuro | Calendário projetado (`2026.2`, `2027.1`…) | Numerar por período curricular — trocaria de unidade no meio da linha do tempo e tiraria do aluno a resposta de "quando eu formo" |
| Onde o projetor roda | Backend, resposta pronta | Projetar no mobile exigiria portar o parser de pré-requisito, que já existe e é testado no backend |
| Atrasadas | Distribuídas pelo projetor, com selo e resumo honesto | Empilhar todas no próximo semestre produz um semestre de 11 matérias para o aluno *mediano* de universidade pública; um bloco "Atrasadas" fora da linha do tempo é o `"Sem período"` com outro nome |
| Teto de carga | O menor entre o período mais pesado da grade e o recorde do aluno | A média subestima quem aperta o passo |
| Persistência | Recalcula sempre; só o ajuste manual vira `PlanoItem` | Gravar a projeção inteira apodrece: um semestre depois o plano descreve um aluno que não existe mais |
| Optativas | Horas genéricas, derivadas de um número | Cards de placeholder seriam fantasmas sem código nem nome |

## O projetor

Uma função pura, sem I/O, em `backend/src/curriculo/projecao-trajetoria.ts`.

### Entradas

- `estrutura: EstruturaCurricularSalva` — componentes com `periodo`,
  `cargaHoraria` e `preRequisito`.
- `historico: Historico` — cursados, pendentes e a matriz de carga horária.
- `marcos: MarcosResponse` — reaproveitado para as equivalências
  (`equivalencias`, `obsoletas`), que já são calculadas hoje.
- `overrides: ItemPlano[]` — o que o aluno moveu à mão.

### O laço

```
aprovados := códigos APR do histórico, mais o código que cada um substitui
             (via marcos.equivalencias — quem cursou VELHA2 satisfaz um
             pré-requisito escrito como NOVA2)
fila      := obrigatórias pendentes não matriculadas, ordenadas por período
             da grade; período desconhecido vai para o fim
semestre  := o seguinte ao último do histórico

enquanto a fila não estiver vazia:
    capacidade := teto
    para cada item da fila, em ordem:
        se avaliarPreRequisito(item, aprovados) e cabe em capacidade:
            aloca em `semestre`; capacidade -= cargaHoraria
    aprovados += tudo que foi alocado neste semestre
    semestre  := próximo
```

`aprovados` só cresce **no fim do semestre**, nunca durante: duas matérias
em que uma é pré-requisito da outra não podem cair no mesmo semestre.

### Teto de carga

```
pesado := maior carga horária somada entre os períodos da grade
leve   := menor
recorde := maior carga horária que o aluno já cursou num único semestre
           (excluindo trancadas e canceladas, mesma regra que a tela já usa
           em componentesComCargaHorariaContada)

teto := min(pesado, recorde), preso ao piso `leve`
```

O `min` é a decisão registrada acima. O piso existe porque `recorde` tem
dois modos de falha que sozinhos travariam a projeção: o aluno do primeiro
período não tem semestre fechado (`recorde = 0`, fila nunca anda) e o aluno
que teve um semestre atípico de 30h ficaria preso nesse teto por toda a
projeção — linha de chegada em 2035. Sem nenhum semestre fechado, o teto
cai direto em `pesado`.

### Válvulas de garantia de progresso

O laço precisa terminar. Duas condições podem impedir isso, e ambas viram
alocação forçada em vez de travamento:

1. **Nenhum item liberado num semestre.** Acontece com pré-requisito
   citando código que não está na grade ativa, ou com o texto de "carga
   horária mínima", que o `avaliarPreRequisito` reprova por design (falha
   fechado). Aloca-se a cabeça da fila mesmo assim, marcada
   `preRequisitoNaoVerificado`.
2. **Item maior que o teto.** Ocupa o semestre sozinho.

Sem essas duas, um pré-requisito circular ou malformado gera laço infinito
no servidor. Elas são a diferença entre "a projeção errou uma matéria" e
"o endpoint não responde".

### Optativas e complementares

Não são componentes na projeção. São dois números —
`historico.cargaHoraria.optativas.pendente` e
`.complementares.pendente` — que o projetor derrama no espaço que sobra do
teto de cada semestre, depois das obrigatórias, e devolve como
`horasOptativas` / `horasComplementares` por semestre.

Deliberadamente **sem id e sem persistência**: o bloco é resíduo de
renderização, não entidade. É isso que deixa a seleção de optativas (item A
do roadmap) barata — a tela de escolha vai operar sobre a exigência inteira
("240h de 360h escolhidas"), não sobre um bloco, e o aluno escolhe todas de
uma vez em vez de abrir três blocos de 120h. Quando escolher, cada optativa
vira componente concreto na fila e as horas genéricas encolhem pelo mesmo
tanto.

Complementares ganham rótulo próprio na tela: não são matérias de catálogo
(estágio, monitoria, atividade), então nunca serão escolhíveis e não devem
parecer optativa pendente de escolha.

### Atrasadas

Uma pendente é atrasada quando seu `periodo` na grade é menor que
`historico.periodoLetivoAtual`. Não muda a alocação — a ordenação por
período já as põe primeiro — mas muda o que a tela diz:

- selo `atrasada · 3º período` viajando junto com o card, onde quer que ele
  caia, para que espalhar o atraso não seja o mesmo que escondê-lo;
- uma linha-resumo acima da linha do tempo: *"5 obrigatórias atrasadas ·
  neste ritmo você conclui em 2028.2, dois semestres além do previsto."*
  O atraso fica dito em número, não deduzido de um desenho.

### Prazo máximo

`zonasDePlanejamento` nunca oferecia um semestre além do
`historico.prazoConclusaoMaximo` — o prazo de jubilamento. A projeção **não
herda esse limite como corte**: parar de alocar ali deixaria matérias sem
semestre nenhum e esconderia justamente o aluno que mais precisa saber.

Ela projeta até a fila esvaziar e devolve `alemDoPrazoMaximo`. A tela trata
isso como aviso, não como bloqueio — o prazo tem prorrogação por processo,
e o app não tem como saber se ele já foi prorrogado.

### Pendentes fora da grade ativa

Uma pendente pode não existir na estrutura ativa, porque o histórico cobra
segundo o currículo *do aluno* e nós resolvemos sempre a **Ativa** — o
aluno de grade antiga diverge. O `classificarComponente` já separa os dois
casos que isso produz:

- **`equivalente`** — a grade nova declara o código antigo no
  `equivalencias` de algum componente. A pendente **herda o período do
  substituto** e é alocada com dado real. Esse é o caso comum.
- **`obsoleta`** — ninguém a menciona. Fica sem período, cai no fim da fila
  e é alocada como qualquer outra, **sem selo e sem urgência**: não é
  atraso, é divergência de catálogo.

## Overrides

Mover um card grava um `PlanoItem` (a tabela e o campo `semestre` já
existem; falta só o endpoint de escrita). O projetor recebe esses itens
como **posição fixa**: consomem teto do semestre em que o aluno os pôs e
saem da fila antes do laço começar.

Mover **não reprojeta o resto na hora**. Se o movimento quebra um
pré-requisito lá na frente, o servidor sinaliza no próximo carregamento
— `"você moveu MATA55 para antes de MATA37"` é uma mensagem melhor que uma
linha do tempo se reorganizando sozinha debaixo do dedo do aluno.

`PlanoItem` já é podado quando o componente é concluído
(`HistoricoRepository`, `codigosConcluidos`), então um override não
sobrevive à matéria que ele posicionava.

## API

`GET /trajetoria` ganha um campo. `marcos` continua como está.

```ts
projecao: null | {
  semestres: {
    semestre: string;                 // "2026.2"
    componentes: {
      codigo: string;
      nome: string;
      cargaHoraria: number;
      periodo: number | null;         // null = obsoleta pura
      atrasada: boolean;
      manual: boolean;                // veio de PlanoItem
      preRequisitoNaoVerificado: boolean;
    }[];
    horasOptativas: number;
    horasComplementares: number;
  }[];
  teto: number;
  atrasadas: number;
  conclusaoProjetada: string;         // "2028.2"
  semestresAlemDoPrevisto: number;    // 0 quando no prazo
  alemDoPrazoMaximo: boolean;         // conclusaoProjetada > prazoConclusaoMaximo
}
```

`projecao: null` quando a estrutura não resolve — mesma degradação que
`marcos` já tem hoje, e pelos mesmos motivos (nome de curso que não casa,
nenhuma estrutura Ativa, falha transitória de scraping). A tela cai no
comportamento atual.

`PUT /trajetoria/plano` recebe `{ codigo, semestre | null }[]` e substitui
os overrides do usuário.

## Mobile

`TrajetoriaTab` perde o bloco inteiro de zonas de planejamento:
`ZONA_SEM_PERIODO`, `ZONAS_FUTURAS`, `planoSalvo` e o uso de
`zonasDePlanejamento`/`poolPlanejavel` saem. A linha do tempo passa a
receber passado e futuro na mesma lista de anos, e os anos futuros herdam o
colapso que os anos passados acabaram de ganhar.

Um semestre futuro é o mesmo objeto visual de um passado, com três
diferenças: sem nota, sem medidor de densidade, e o menu "Mover para" agora
oferece todos os semestres da projeção em vez de duas zonas fixas. O aviso
`"Ainda não salva"` sai — passa a ser salvo.

`zonasDePlanejamento` fica sem chamador e é removida junto com seus testes.

## Testing

Backend, no projetor (função pura, então caso a caso barato):

- aluno no ritmo → um semestre por período da grade, nada marcado atrasado;
- aluno atrasado → atrasadas primeiro, espalhadas pelo teto, e
  `semestresAlemDoPrevisto` maior que zero;
- cadeia de pré-requisito → A e B, com B dependendo de A, nunca no mesmo
  semestre;
- equivalência → quem cursou `VELHA2` satisfaz pré-requisito escrito como
  `NOVA2`;
- pendente equivalente → herda o período do substituto;
- pré-requisito malformado → aloca com `preRequisitoNaoVerificado`, não
  trava;
- matéria maior que o teto → semestre só dela;
- aluno sem semestre fechado → teto cai em `pesado`, fila anda;
- semestre atípico de 30h → teto respeita o piso `leve`;
- override → posição fixa, consome teto, não é reordenado.

Controller: `projecao: null` quando `resolverMarcos` falha, sem derrubar o
resto da resposta.

Mobile: semestre futuro renderizado com card sem nota; selo de atrasada;
linha-resumo; bloco de horas genéricas; mover card chamando o `PUT`.

## Open risks

- **A projeção não sabe de oferta.** Vai alocar uma matéria num semestre em
  que ela não abre. Irrecuperável com o que está no banco; contido pelo
  fato de o plano ser editável.
- **O teto ignora pré-requisito ao medir.** Um semestre pode ficar abaixo
  do teto não por falta de vaga, mas porque nada mais estava liberado —
  correto, mas pode parecer bug para quem olha.
- **Currículo antigo.** Quanto mais velha a grade do aluno, mais pendentes
  caem no caso `obsoleta`, e menos a projeção vale. O selo cobre a matéria
  individual, mas não existe um aviso de "sua grade é antiga demais para
  esta projeção" — vale medir na prática antes de inventar um.
