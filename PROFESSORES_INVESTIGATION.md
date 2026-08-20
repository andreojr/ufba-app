# Investigação: página de professores (item 7 do roadmap)

## Status: MAPEADO — nada implementado ainda

Spike feito em 19/08/2026 contra o SIGAA real da UFBA, **sem login nenhum** — o
portal público de docentes não usa sessão autenticada. Todas as requisições
abaixo foram executadas de verdade; nenhum parser, endpoint ou tela foi escrito.
Este doc é o insumo pro design.

Versão do SIGAA no momento do spike: `4.13.8_39-20260731`.

## Resumo de uma linha

O perfil do docente é **três GETs puros** (`portal.jsf`, `producao.jsf`,
`disciplinas.jsf`), sem cookie, sem ViewState, com HTML de ids semânticos e
7–50 KB por página. O único ponto de trabalho é **descobrir o `siape`** a partir
do nome do professor, que exige um POST JSF na busca — e isso já foi validado
contra um atestado real (ver seção de validação).

## As duas metades do problema

| | Como é | Dificuldade |
|---|---|---|
| **Perfil** (dado o `siape`) | GET público, sem estado | trivial |
| **Nome → `siape`** | POST JSF com sessão + ViewState | é aqui que mora o trabalho |

O app hoje tem o **nome** do professor, não o `siape`: `Turma.docente` em
[`parsers/turma.ts`](backend/src/sigaa-engine/parsers/turma.ts) é preenchido a
partir do `<span class="docente">` do atestado de matrícula
([`parsers/atestado-turmas.ts:126`](backend/src/sigaa-engine/parsers/atestado-turmas.ts)).
Nenhum documento que o app já lê carrega o `siape`.

## Perfil: os três GETs

Chave única = `siape` (matrícula SIAPE, 6–7 dígitos).

| Página | URL | Tamanho |
|---|---|---|
| Perfil Pessoal | `/sigaa/public/docente/portal.jsf?siape=NNNNNNN` | ~7,5 KB |
| Produção Intelectual | `/sigaa/public/docente/producao.jsf?siape=NNNNNNN` | ~8 KB |
| Disciplinas Ministradas | `/sigaa/public/docente/disciplinas.jsf?siape=NNNNNNN` | ~52 KB |

Sem cookie, sem ViewState, sem POST. `siape` inexistente ou ausente → **302**
(não 404) — validar por status, não por corpo.

### `portal.jsf` — estrutura

Ids semânticos e estáveis, `<dl>/<dt>/<dd>`. Parser fácil:

```html
<div id="perfil-docente">
  <dl><dt> Descrição pessoal </dt><dd><i> não informada </i></dd></dl>
  <dl><dt> Formação acadêmica/profissional … </dt><dd> Bacharel em … <br /> … </dd></dl>
  <dl><dt> Áreas de Interesse <span class="info">…</span></dt><dd> Computação Gráfica<br />… </dd></dl>
  <dl><dt> Currículo Lattes: </dt><dd><a id="endereco-lattes" href="http://lattes.cnpq.br/…"> … </a></dd></dl>
</div>
<div id="formacao-academica"> … ou <p class="vazio">Formação acadêmica não cadastrada</p> </div>
<div id="contato">
  <dl><dt> Endereço profissional </dt><dd> … </dd></dl>
  <dl><dt> Sala </dt><dd> IC- 2012 </dd></dl>
  <dl><dt> Telefone/Ramal </dt><dd> 6299 </dd></dl>
  <dl><dt> Endereço eletrônico </dt><dd> antonio.apolinario@ufba.br </dd></dl>
</div>
```

O cabeçalho lateral (`div#left.barra_professor`) traz nome, unidade e a foto.

Valores multi-linha vêm separados por `<br />`, então o parser deve devolver
`string[]`, não texto colado.

**O bloco vazio é a regra, não a exceção — e isso define a tela.** Em 3 dos 4
docentes do atestado real, o `#perfil-docente` colapsa inteiro:

```html
<div id="perfil-docente">
  <h4>Perfil Pessoal</h4>
  <p class="vazio"> Perfil pessoal não cadastrado </p>
</div>
```

Sem formação, sem áreas de interesse, sem Lattes — e sem foto. O que sobra é
`#contato` (endereço, sala, ramal, e-mail), que estava preenchido em **4 de 4**,
mais o `disciplinas.jsf`.

Não mata a feature: sala, e-mail e ramal são justamente o que o aluno procura, e
o roadmap pede "além de só o nome". Mas muda o eixo do design — a tela tem que se
organizar em torno de **contato + o que ele ensina**, com bio e foto como enfeite
quando existirem. Layout que assuma perfil rico deixa 3 de 4 parecendo quebrados.

### `disciplinas.jsf` — o dado mais interessante

`table.listagem` agrupada por semestre, do mais recente pro mais antigo:

```html
<tr><td class="anoPeriodo" colspan="5"> 2026.2</td></tr>
<tr>
  <td class="codigo"> MATA65 </td>
  <td> <a href="/sigaa/link/public/ensino/visualizarComponente/44750">COMPUTAÇÃO GRÁFICA</a> </td>
  <td class="ch"> 60h </td>
  <td class="horario"> 24T34 (19/08/2026 - 19/12/2026)</td>
</tr>
```

Três consequências:

1. O `24T34 (19/08/2026 - 19/12/2026)` é **exatamente** o formato que
   [`schedule-code.ts`](backend/src/sigaa-engine/schedule-code.ts) e
   `buildTurmaSlots` já parseiam. Reúso direto, zero parser novo.
2. Dá pra mostrar "há quantos semestres ele dá essa matéria" — histórico
   completo, não só o semestre atual.
3. É a **âncora de desambiguação** do match por nome (ver abaixo): o siape certo
   é o que aparece dando a matéria do usuário em 2026.2.

O `visualizarComponente/44750` é id de componente curricular — mesma chave que o
item 3 do roadmap (catálogo de matérias) vai querer.

### `producao.jsf` — entra, como sinal de orientação

O rótulo "Produção Intelectual" engana duas vezes. Em 5 docentes testados as
**únicas** seções que aparecem são `Trabalho de Fim de Curso` e
`Orientações de Pós-Graduação` — nenhum artigo, livro ou publicação. E o "Trabalho
de Fim de Curso" **não é o TCC do docente**: são os TCCs que ele orientou (o nome
que acompanha o título é o do aluno). O que o docente fez na própria formação está
no campo "Formação acadêmica/profissional" do `portal.jsf`.

Mesmo assim vale: os títulos dos TCCs orientados são um mapa dos **temas em que
ele aceita orientar**, e a quantidade de orientações em andamento indica
disponibilidade. Pro aluno decidindo a quem pedir orientação, é o dado mais
direto da página inteira.

O que guardar — o suficiente pro sinal, sem dado pessoal de terceiro:

- **TCCs orientados**: título + ano. Sem o nome do aluno.
- **Orientações de pós**: contagem por nível (Mestrado/Doutorado) e por situação
  (em andamento / concluída). Sem nomes.

Três coisas medidas que definem o parser:

1. **A contagem do `<h2>` é inflada por duplicatas.** `Orientações de
   Pós-Graduação (42)` do siape 1652496 conta linhas repetidas — a mesma
   orientação (mesmo nome, mesma data, mesma situação) aparece 2×; idem no
   1055312. Dedupar por `(nível, nome, início)` antes de contar. O nome entra
   nisso como chave de dedupe **em memória**, e não é persistido.
2. **A situação não é confiável isoladamente**: existe linha com data de fim
   preenchida e situação `Orientação em Andamento`, e `Concluída em ` sem data.
3. **Parsear de trás pra frente.** Formatos:
   - TCC: `Título, ALUNO, MM/AAAA`
   - Orientação: `Nível, Aluno, início - fim, situação`

   O título do TCC pode conter vírgula, então dividir da direita: o último campo é
   a data `MM/AAAA`, o penúltimo é o nome, o resto é título. Da esquerda, um
   título com vírgula quebra tudo.

### Foto — precisa de proxy no backend

`/shared/verFoto?idFoto=252422&key=9cb971ad6ba0351b3fbccc944959737e` — pública,
sem cookie. Quatro coisas medidas:

- **~700 KB por foto.** Não é o arquivo original: o SIGAA normaliza pra **PNG
  500×625 RGBA** (idêntico nos dois docentes medidos). PNG com alpha pra foto de
  rosto é a razão do peso. Recomprimido pra JPEG q80 a 200px: **10,7 KB, 65×
  menor**. E o HTML exibe com `height="100"` — 700 KB pra pintar ~80×100 px.
- **`Content-Type` mente**: declara `image/jpeg` e entrega PNG. Não usar o header
  pra escolher extensão nem decoder.
- **`key` errada não dá erro**: responde 200 com 14 bytes. Validar tamanho, não
  status.
- **Cobertura**: 58% na busca "SILVA" (198/339), 77% no DCC (24/31) — mas 1 de 4
  nos docentes do atestado real. Sem foto, o SIGAA aponta pra
  `/sigaa/img/no_picture.png`.

Decisão: **proxy com resize e cache no backend**. O que fecha a questão não é o
peso, é que o par `idFoto`+`key` só existe dentro do HTML do SIGAA — o mobile
nunca poderia montar a URL sozinho, então o dado passa pelo servidor de todo
jeito. A 11 KB por foto, o problema de peso deixa de existir.

## Nome → `siape`: a busca

`POST /sigaa/public/docente/busca_docentes.jsf`

```
form                  = form
form:nome             = <nome ou vazio>
form:departamento     = <id do departamento ou 0 para TODOS>
form:buscar           = Buscar
javax.faces.ViewState = <atual>
```

Precisa de `JSESSIONID` + ViewState — **POST a frio devolve 302**. Fluxo: 1 GET
inicial (pega cookie e `ViewState=j_id1`), depois N POSTs encadeando o ViewState
(`j_id1 → j_id2 → j_id3…`). Verificado: 3 buscas seguidas na mesma sessão
funcionam. É a mesma máquina de estados que
[`session.ts`](backend/src/sigaa-engine/session.ts) já implementa — só que sem
login.

### Resultado

```html
<table class="listagem"><caption> Docentes encontrados (31) </caption>
  <tr class="linhaPar topo">
    <td class="foto"><img src="/shared/verFoto?idFoto=252422&key=9cb971ad…" height="100"/></td>
    <td><span class="nome">ANTONIO LOPES APOLINARIO JUNIOR</span>
        <span class="departamento"> DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC </span>
        <span class="pagina"><a href="/sigaa/public/docente/portal.jsf?siape=1815041">ver página pública</a></span>
    </td></tr>
```

**Sem paginação** — 676 linhas vieram numa resposta só na busca por "SILVA".
Um departamento inteiro sai em 1 POST.

### Semântica da busca — tudo medido

| Comportamento | Resultado |
|---|---|
| Mínimo de caracteres | **4** — menos que isso devolve erro `É necessário informar pelo menos 4 caracteres do nome do docente` |
| Nome vazio + departamento `0` | erro `Especifique um nome ou escolha uma unidade` |
| Caixa | indiferente (`apolinario` == `APOLINARIO`) |
| Acentos na consulta | **insensível** — `LUIS DA PAIXAO` acha `LUÍS DA PAIXÃO SILVA DE JESUS` |
| Substring contígua | `LOPES APOLINARIO` acha; `ANTONIO APOLINARIO` (tokens não adjacentes) **não acha** |
| Duplicatas | cada docente aparece **2×** (um vínculo por lotação), mesmo `siape` — dedupar por `siape` |
| Homônimos | 339 docentes distintos na busca "SILVA", **nenhum** nome repetido entre siapes diferentes |

### Gotcha grande: encoding do corpo do POST

O SIGAA lê o corpo do form como **ISO-8859-1**. Mandar `LUÍS DA PAIXÃO` em
UTF-8 devolve 200 **sem tabela e sem mensagem de erro** — falha silenciosa.
O mesmo nome percent-encodado em latin-1 (`LU%CDS+DA+PAIX%C3O`) acha.

Isso é relevante além desta feature: `encodeFormBody` em
[`http-client.ts:23`](backend/src/sigaa-engine/http-client.ts) usa
`URLSearchParams`, que é UTF-8 sempre. Nunca deu problema porque nada que o app
posta hoje tem acento (login, ViewState, ids). Esta é a primeira feature que
posta texto humano.

Mitigação recomendada: **normalizar a consulta** (maiúsculas + remover
diacríticos) antes de mandar. A busca é acento-insensível, então a consulta vira
ASCII puro e o problema de encoding some junto. Corrigir o `encodeFormBody`
continua valendo, mas aí como conserto próprio, não como pré-requisito.

### Normalização do lado do dado também

Os nomes cadastrados **não** são uniformes: dos 339 da amostra "SILVA", 6 têm
acento e pelo menos um está em caixa mista (`Clayton Silva de Almeida`). O match
`nome do atestado ↔ nome do SIGAA público` precisa de
`uppercase + strip diacríticos + colapsar espaços` dos dois lados.

## Validação com atestado real — o match por nome funciona

Testado em 19/08/2026 com o atestado de matrícula real de 2026.2 (6 turmas
matriculadas + 1 indeferida, 5 nomes de docente distintos). Cada nome foi
enviado **exatamente como sai do atestado**, sem tratamento algum, e o `siape`
resultante foi cruzado com o `disciplinas.jsf` do candidato:

| Cód. | Nome no atestado | Busca | `disciplinas.jsf` 2026.2 |
|---|---|---|---|
| ECOB40 | JULYAN GLEYVISON MACHADO GOUVEIA LINS | siape 1055312, único | ✅ ECOB40 |
| ENGG54 | ANTONIO CARLOS LOPES FERNANDES JUNIOR | siape 2530359, único | ✅ ENGG54, ENGG67 |
| ENGG56 | WAGNER LUIZ ALVES DE OLIVEIRA | siape 2042176, único | ✅ ENGG56 |
| ENGG67 | *(mesmo docente do ENGG54)* | — | ✅ |
| ENGG64 | ANDRE GUSTAVO SCOLARI CONCEICAO | siape 1652496, único | ✅ ENGG64 |
| MATA58 | LARISSA BARBOSA LEONCIO PINHEIRO | **0 resultados** | — |
| MATA59 | *(atestado não traz docente)* | — | — |

**4 de 4 dos que existem no cadastro acertaram**, com `siape` único e verificado
contra a disciplina certa no semestre certo. O risco que era o bloqueio da
feature — nome abreviado ou grafado diferente — **não se materializou**: o nome
do atestado e o do portal público saem da mesma base.

A MATA58 não é falha de match: a docente **não existe no cadastro público**.
Confirmado por três buscas (`LARISSA` → 14 resultados, nenhuma ela; `LEONCIO` →
0; `PINHEIRO` → 22, nenhuma ela). Provável substituta ou contratação recente.

Custo real medido pro semestre inteiro: **1 GET + 5 POSTs**.

## Arquitetura: sob demanda (decidido)

A tela manda o array de nomes que já veio do SIGAA; o backend resolve
`nome → siape` na hora e devolve o perfil. Uma sessão pública é aberta uma vez e
os POSTs de busca encadeiam o ViewState.

**Escolha do candidato**: filtrar por **igualdade exata normalizada**
(`uppercase + sem diacrítico + espaços colapsados`) e só cair na primeira
ocorrência se não houver match exato. Motivo: a busca é substring contígua, então
um nome que seja prefixo de outro traz os dois. Frequência medida nos 339
docentes do dump "SILVA": **1 caso** (`ALINE SILVA` ⊂ `ALINE SILVA DE MOURA`).
Raro, e a ordenação alfabética até salvaria, mas o filtro é grátis.

Varrer os 94 departamentos pra montar catálogo completo continua sendo uma opção
— mas como otimização futura, não pré-requisito.

### Resolver uma vez, depois só GET

A busca por nome é **custo de primeira vez**. Resolvido o `siape`, ele é a chave
estável dali em diante e todo sync seguinte é GET direto — sem sessão, sem
ViewState, sem POST.

```
tem siape pro nome?
├── não → GET sessão + POST busca → siape → grava → GET perfil → grava
└── sim → GET perfil (ou nem isso, se o cache estiver fresco)
```

Diferença importante em relação a `CachedGrade`/`CachedSchedule`: essas tabelas
são **por usuário**; docente **não é**. O perfil é o mesmo pra todo mundo, então
a tabela é global e o segundo aluno de ENGG54 custa zero requisição. Com o app
inteiro dentro de poucos cursos, o conjunto de docentes satura rápido — o estado
estacionário é ~nenhuma requisição ao SIGAA por abertura de tela.

Esboço, seguindo a convenção do schema (`@map` snake_case, `fetchedAt`):

Coluna pra tudo, `null` quando o SIGAA não traz — o campo vazio é o caso comum,
mas quando vem preenchido é exatamente o que o usuário quer ver:

```prisma
// Global — não é cache por usuário: o perfil público é o mesmo pra todos.
model Docente {
  siape        String  @id
  nome         String
  departamento String?
  unidade      String?

  // portal.jsf — #perfil-docente (ausente em 3 de 4 na amostra real)
  descricaoPessoal   String? @map("descricao_pessoal")
  formacao           String? // multi-linha: <br /> vira \n
  areasInteresse     String? @map("areas_interesse")
  lattesUrl          String? @map("lattes_url")

  // portal.jsf — #contato (preenchido em 4 de 4)
  enderecoProfissional String? @map("endereco_profissional")
  sala                 String?
  telefone             String?
  email                String?

  // listas: disciplinas.jsf e producao.jsf
  disciplinas    Json? // [{ semestre, codigo, nome, cargaHoraria, horario }]
  tccsOrientados Json? @map("tccs_orientados") // [{ titulo, ano }] — sem nome de aluno
  orientacoesMestradoAndamento Int? @map("orientacoes_mestrado_andamento")
  orientacoesMestradoConcluidas Int? @map("orientacoes_mestrado_concluidas")
  orientacoesDoutoradoAndamento Int? @map("orientacoes_doutorado_andamento")
  orientacoesDoutoradoConcluidas Int? @map("orientacoes_doutorado_concluidas")

  fotoId    String?  @map("foto_id")
  fotoKey   String?  @map("foto_key")
  fotoPath  String?  @map("foto_path") // objeto no bucket, já redimensionado
  fetchedAt DateTime @default(now()) @map("fetched_at")

  @@map("docentes")
}

// nome normalizado → siape. Guarda também o MISS (siape null), pra não repetir
// a busca a cada sync de quem não tem cadastro público (ver MATA58 acima).
model DocenteLookup {
  nomeNormalizado String   @id @map("nome_normalizado")
  nomeOriginal    String   @map("nome_original")
  siape           String?
  resolvedAt      DateTime @default(now()) @map("resolved_at")

  @@map("docente_lookup")
}
```

### Invalidação: TTL único de 1 mês, revalidado no acesso

Uma regra só, valendo igual pra hit e pra miss: se `fetchedAt`/`resolvedAt` tem
mais de 1 mês quando a linha é requisitada, ela é ressincronizada. Sem lógica
dupla, sem job agendado.

O preço de unificar é o miss ficar até um mês desatualizado — a docente da MATA58
só apareceria um mês depois de ser cadastrada. Num semestre de ~4,5 meses ela
ainda aparece a tempo; é atraso, não erro. Vale a simplicidade.

Duas decisões que vêm junto e não são detalhe de implementação:

- **Servir stale e revalidar em background.** Perfil vencido não é perfil errado:
  é o mesmo dado de um mês atrás, de uma página que muda uma vez por semestre.
  Responder do banco na hora e ressincronizar fora do request dá tela instantânea
  e torna o SIGAA fora do ar invisível pro usuário — o resync falha, tenta de
  novo no próximo acesso. Síncrono, um SIGAA lento vira tela travada.
- **Jitter no TTL.** Os docentes de um semestre são resolvidos todos na primeira
  abertura da tela, então têm `fetchedAt` quase idêntico e vencem todos juntos. A
  abertura que cruzar essa fronteira paga 6 resyncs de uma vez. `30 dias ± 3`
  espalha as expirações a custo zero.

## Riscos e aberto

1. ~~O nome do atestado casa com o do portal público?~~ **Resolvido** — ver seção
   de validação acima.
2. **Professor sem cadastro público** — confirmado na prática, 1 em 5 já na
   primeira amostra real. A tela precisa de estado "perfil não disponível" de
   primeira classe. E há um segundo buraco a montante: o atestado pode não trazer
   docente nenhum pra uma turma (MATA59). São dois estados vazios diferentes —
   "não sabemos quem é" e "sabemos, mas não tem perfil".
3. **Homônimos.** Não apareceram: 339 docentes distintos na busca "SILVA", nenhum
   nome repetido entre siapes diferentes. Com ~5 mil docentes é questão de tempo.
   Desempate barato quando acontecer: cruzar `disciplinas.jsf` do candidato com o
   código da matéria do usuário no semestre corrente — a técnica já validada
   acima. Se sobrar ambiguidade, não adivinhar.
4. **Rate limit dos endpoints públicos: desconhecido.** Não testei volume. Sob
   demanda com cache mantém o tráfego baixo, mas o `withRetry`/429 de
   [`http-client.ts`](backend/src/sigaa-engine/http-client.ts) é o mínimo.
5. ~~Foto de 660 KB~~ **Resolvido** — proxy com resize no backend, binário no
   bucket do Railway (o backend já vai subir lá).
6. **Sem `siape` em nenhum documento autenticado.** Confirmei que a Consulta de
   Turmas pública (`/sigaa/public/turmas/listar.jsf`) **não** traz link com
   `siape` — não existe atalho, o match por nome é obrigatório.

## Escopo sugerido pro design

**Fase 1** — `nome → siape` sob demanda com cache + as três páginas
(`portal.jsf`, `disciplinas.jsf`, `producao.jsf`), com a tela organizada em torno
de contato e disciplinas ministradas, e bio/áreas/orientações aparecendo quando
existirem.

**Fase 2** — foto, via proxy com resize e bucket no Railway.
