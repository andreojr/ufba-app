# Investigação: espelhar a Turma Virtual ("lousa" do professor) no app

## Status: MAPEADO — nada implementado ainda

Spike de reconhecimento feito em 19/08/2026 contra o SIGAA real da UFBA, com um
`JSESSIONID` emprestado de uma sessão logada no browser (mesma técnica de
validação sugerida em [`HISTORICO_PDF_INVESTIGATION.md`](HISTORICO_PDF_INVESTIGATION.md)).
Navegação e estruturas HTML confirmadas na prática. Nenhum parser, endpoint ou
tela foi escrito — este doc é o insumo pro design.

O que motivou: hoje o SIGAA avisa por e-mail quando o professor posta algo na
turma. A ideia é espelhar esse conteúdo no app e notificar por push.

## Onde fica

A "lousa" é a **Turma Virtual**, em `/sigaa/ava/index.jsf` (AVA = Ambiente
Virtual de Aprendizagem) — um subsistema separado do portal discente que o
`fetchSchedule` já usa.

### Entrada: postback do portal home

Cada turma no portal home tem seu próprio `<form id="form_acessarTurmaVirtualN">`.
Hoje o [`parsers/turmas-horario.ts`](backend/src/sigaa-engine/parsers/turmas-horario.ts)
lê só o texto do `<a>` e descarta o resto — é exatamente esse form que dá acesso
à Turma Virtual:

```
POST /sigaa/portais/discente/discente.jsf
  form_acessarTurmaVirtual                          = form_acessarTurmaVirtual
  form_acessarTurmaVirtual:j_id_jsp_315194548_378   = (mesmo valor)
  frontEndIdTurma                                   = <SHA-1 de 40 chars>
  javax.faces.ViewState                             = <atual>
```

Responde **200 com a Turma Virtual direto no corpo** (sem 302).

O `form_acessarTurmaVirtual` é o form da primeira turma; as seguintes ganham
sufixo `j_id_1`, `j_id_2`… e o id do command link acompanha
(`…_378j_id_1`). Como em todo postback JSF do SIGAA, o `j_id_jsp_*` **varia por
deploy** — localizar por posição/rótulo, nunca hardcodar (mesma disciplina que
[`parsers/portal-menu.ts`](backend/src/sigaa-engine/parsers/portal-menu.ts) já
aplica).

O `frontEndIdTurma` é um token opaco por turma. Existe também um `idTurma`
**numérico** (ex. `393380`), usado pelo feed de atualizações (ver abaixo).

### Menu da turma

Dentro do AVA, `<form id="formMenu" action="/sigaa/ava/index.jsf">`. Itens
confirmados para o vínculo de graduação:

Principal · Gerenciar Perfil · Plano de Curso · Participantes · Visualizar
Programa · Fóruns · **Notícias** · Frequência · Ver Grupo · Ver Notas ·
Conteúdo/Página web · Referências · Vídeos · **Arquivos** · **Avaliações** ·
Enquetes · **Tarefas** · Questionários · Situação dos Discentes · Linha do
Tempo · Manual da Turma Virtual

Postback de item de menu:

```
POST /sigaa/ava/index.jsf
  formMenu                        = formMenu
  formMenu:j_id_jsp_1857845999_72 = formMenu:j_id_jsp_1857845999_73   (hidden do form)
  <linkId>                        = <linkId>
  javax.faces.ViewState           = <atual>
```

Também existe um **seletor de turmas dentro do AVA** (`formTurma:…`) listando
todas as turmas do semestre — dá pra pular de turma em turma sem voltar ao
portal.

## URLs por seção

Cada seção tem endpoint próprio, e a maioria cede a **GET direto** depois de
entrar na turma (a turma corrente vive na sessão server-side), dispensando toda
a navegação por menu e o malabarismo de ViewState:

| Seção | URL | GET direto |
|---|---|---|
| Notícias (lista) | `/sigaa/ava/NoticiaTurma/listar.jsf` | sim |
| Notícia (detalhe) | `/sigaa/ava/NoticiaTurma/mostrar.jsf` | **não** (ver gotcha 2) |
| Tarefas | `/sigaa/ava/TarefaTurma/listar.jsf` | sim |
| Avaliações | `/sigaa/ava/DataAvaliacao/listar.jsf` | sim |
| Linha do Tempo | `/sigaa/ava/Relatorios/timeline.jsf` | sim |
| Arquivos | `/sigaa/ava/ArquivoTurma/listar_discente.jsf` | não (302 → index) |

## Estruturas parseáveis

Boa notícia: são **classes semânticas**, não ids gerados — parser estável.

### Última notícia (inline na página principal)

```html
<div class="descricaoOperacao" id="ultimaNoticia">
  <h4> Última Notícia<br>Início do Semestre - 18/08/2026 13:44 </h4>
  <span class="conteudoNoticia"><p>Boa tarde, turma.</p>…</span>
  <small> Cadastrado por: <i> NOME DO DOCENTE</i></small>
</div>
```

O corpo é **HTML rico** — a página traz CSS próprio pra `ul/ol/strong/em`
dentro de `.conteudoNoticia`. Espelhar fiel exige renderizar HTML na tela, não
texto puro. Isso é decisão de design da tela mobile, não detalhe de parser.

### Lista de notícias

`table.listing` com `Título | Data | (Visualizar)`. O link de visualizar carrega
o **id numérico da notícia**:

```html
<td class="icon"><a onclick="…jsfcljs(…,{'…:…301':'…','id':'6279402'},'')…">
  <img src="/sigaa/ava/img/zoom.png" title="Visualizar"></a></td>
```

Esse `id` é chave primária de verdade — a base natural pro dedupe de "o usuário
já viu isso".

### Detalhe da notícia

`/sigaa/ava/NoticiaTurma/mostrar.jsf`, `<legend>Visualização de Notícia</legend>`,
`ul.form > li` com `<label>Título:</label>`, `<label>Data:</label>`
(`18/08/2026 13:44`) e o corpo em `td.conteudoNoticia`.

### Tópicos de aula

```html
<div class="topico-aula">
  <div class="titulo">Aula 1 (20/08/2026 - 20/08/2026)</div>
  <div class="conteudotopico">…</div>
</div>
```

### Painéis laterais (resumo por turma)

`simpleTogglePanel` do RichFaces — `<div id="X_header">` + `<div id="X_body">`:
Andamento das Aulas, Notícias, Enquete, **Atividades**, Avaliações, Mensagens
dos Fóruns. O painel "Atividades" já vem agregado (`18/08 Nova Notícia: Início
do Semestre`).

## Feed global (o atalho pra notificação)

O **portal home** tem `#atualizacoes-turma` — feed cross-turma, sem precisar
entrar em turma alguma:

```html
<div class="rotator"><table>
  <tr><td>18/08/2026 - <a onclick="…{'idTurma':'393380'}…">SISTEMAS OPERACIONAIS (2026.2)</a></td></tr>
  <tr><td>Nova Notícia: Início do Semestre</td></tr>
</table></div>
```

Consequência arquitetural: **login + 1 GET** dá as novidades de todas as turmas,
em vez de ~14 requests varrendo 6 turmas (entrar + listar por turma). Traz data,
turma e tipo de evento com título — suficiente pra notificar. Não traz corpo nem
o id da notícia, então o corpo continua vindo por demanda quando o usuário abre
o app.

## Gotchas (todos custaram tentativa e erro)

1. **Postback seção → seção falha silenciosamente com HTTP 200.** Navegar de uma
   página de conteúdo direto pra outra devolve a *página principal*, sem erro
   algum. Só funciona saindo da Principal. Sequência verificada:
   `Notícias → Principal → Arquivos` funciona; `Notícias → Arquivos` não. Um
   scraper ingênuo aqui produz dados errados sem levantar exceção — validar que
   a página recebida é a esperada, não confiar no status.
2. **`GET mostrar.jsf?id=X` renderiza a casca vazia.** Retorna 200 com
   `<legend>Visualização de Notícia</legend>` e os `<label>`s, mas Título, Data e
   Texto **em branco** — o `?id=` na query é ignorado. O corpo só vem no POST com
   `id` como campo de form. Isso parecia uma simplificação enorme e não é.
3. **Acentos vêm como entidades numéricas** (`Not&#237;cias`). Buscar por
   `"Notícias"` no HTML cru não casa. Somado ao ISO-8859-1 que o
   [`http-client.ts`](backend/src/sigaa-engine/http-client.ts) já trata, são duas
   camadas distintas de escape.

## Estado do conteúdo hoje — leia antes de planejar

O semestre 2026.2 começou em **18/08/2026**, um dia antes deste spike. Varredura
das 6 turmas:

| Turma | Notícias | Avaliações | Tópicos | Tarefas/Arquivos/Fóruns |
|---|---|---|---|---|
| ENGG54 Laboratório Integrado III-A | — | — | — | — |
| ENGG56 Projeto de Circuitos Int. Digitais | — | 21/10 | — | — |
| MATA59 Redes de Computadores I | — | — | — | — |
| MATA58 Sistemas Operacionais | **1** | 06/10 | 33 (vazios) | — |
| ENGG67 Tópicos Especiais em Eng. Comp. I | — | 22/09 | — | — |
| ENGG64 Visão Computacional | — | 02/12 | — | — |

Existe **uma única notícia** em todas as disciplinas. Os 33 tópicos de aula de
MATA58 têm título e data mas `conteudotopico` **vazio** — o professor montou o
cronograma e ainda não postou material.

Implicações diretas:

- **Notícias e Avaliações**: dá pra implementar e testar com fixture real agora.
- **Tópicos com anexo, Tarefas, Arquivos, Fóruns**: estrutura nunca vista. Fazer
  parser aqui é adivinhação — o mesmo bloqueio que mantém o `boletim.ts` com
  `NotImplementedException` em [`sigaa.controller.ts`](backend/src/sigaa-engine/sigaa.controller.ts)
  esperando fixture real.
- **Avaliações é o dado com valor imediato**: populado em 5 das 6 turmas hoje,
  enquanto a lousa propriamente só enche ao longo do semestre.

## Aberto

1. **Capacidade do rotator de "Últimas Atualizações".** Não sei quantas entradas
   retém — com uma só existindo, não há como medir. Se retém poucas, uma rajada
   de posts pode empurrar itens pra fora antes do poll pegar. Risco real de
   perder notificação se o polling depender só desse feed.
2. **O que dispara o e-mail hoje** não é determinável do HTML. "Nova Notícia" é
   o candidato óbvio, mas é inferência.
3. **Se `frontEndIdTurma` é estável entre sessões** — não testável sem novo
   login. Não é bloqueante: o backend loga sozinho e re-raspa o home por 1
   request.
4. **Push exige credencial guardada.** Quem escolheu `syncMode: "device"` não
   pode receber push server-side — o backend não tem como logar sozinho. O
   [`CredentialVault`](backend/src/sigaa-engine/credential-vault.ts) e o
   `AuditLog` já foram desenhados prevendo isso (o comentário do schema fala de
   *"relogin for a background notification fetch"*), mas é decisão de produto,
   não técnica.
5. **Infra de push não existe.** Nem `expo-notifications` no mobile, nem
   agendamento no backend (`@nestjs/schedule` ausente).

## Escopo sugerido pro design

**Fase 1 — espelhar.** Notícias (lista + detalhe por demanda, renderizando HTML
rico), Avaliações e cronograma de tópicos. Os três validáveis com HTML real
hoje. Tarefas/Arquivos/materiais ficam pra quando houver conteúdo.

**Fase 2 — notificar.** Poll do feed global do portal home (barato), dedupe pelo
id numérico da notícia, push via `expo-notifications`. Depende de resolver o
item 1 (capacidade do rotator) e o item 4 (credencial guardada) acima.

Cada fase merece spec e plano próprios.
