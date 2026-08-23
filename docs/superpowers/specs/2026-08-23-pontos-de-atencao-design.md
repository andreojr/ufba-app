# Pontos de atenção: provas e trabalhos — design

Data: 2026-08-23
Item do ROADMAP: 13 (foco B do ciclo)

## Problema

O app responde bem o retrospectivo — histórico, CR, trajetória, grade — e não
responde nada do prospectivo. O aluno não tem onde ver "o que vence primeiro".

O ROADMAP previa extrair esse dado da Turma Virtual (`/sigaa/ava/DataAvaliacao/listar.jsf`).
**Esta spec descarta essa origem na v1.** O preenchimento da Turma Virtual varia
de professor para professor: a varredura de 19/08 achou avaliação marcada em 5
das 6 turmas, o que significa que uma em seis não teria nada — e nenhuma
garantia de que as cinco estejam corretas ou atualizadas. Um prazo errado
importado silenciosamente é pior do que prazo nenhum, porque o aluno confia
nele. A v1 ignora por completo o que a Turma Virtual diz sobre prazos e deixa o
cadastro com os alunos.

## Escopo

Entra:

- `Turma` como entidade global, independente do aluno, com tabela de junção.
- Pontos de atenção criados por aluno, visíveis para toda a turma.
- Confirmação e contestação por aluno, com rebaixamento e destravamento
  automáticos.
- Tela de cadastro/edição, lista completa e a nova seção na home.

Não entra:

- Notificação push (item 11 do ROADMAP; a feature mostra os prazos quando o app
  abre).
- Qualquer leitura de prazo vinda da Turma Virtual.
- Peso da nota, anexo, entrega em etapas, histórico de revisões.

## Pré-condição: identidade de turma

Hoje não existe identidade de turma. `CachedTurma` é filha de `CachedSchedule`
(chave `userId`), é substituída por inteiro a cada sync, e o parser descarta a
coluna "Turma" do atestado de matrícula.

Essa coluna é a identidade que falta. No fixture: `ECOB40 · 16 · 2026.2`. A
chave natural `(semestre, codigo, numero)` identifica uma turma em toda a UFBA
sem depender de nenhum id interno do SIGAA.

Ela só existe no caminho do atestado. `parseTurmasHorario` (a "Minhas Turmas" da
home do portal) não traz nem código nem número.

### Decisão: o fallback do portal deixa de valer

Falha no postback do atestado passa a ser erro de sincronização — "não foi
possível sincronizar sua conta" — em vez de queda para a home do portal.

**Risco aceito:** o fallback existia como rede de segurança justamente porque o
postback do atestado é um POST JSF, mais frágil do que ler uma página já
carregada. Removendo-o, qualquer falha nesse postback deixa o aluno sem horário
nenhum, não apenas sem pontos de atenção. O parser `parseTurmasHorario`
permanece no código como ferramenta de diagnóstico, apenas não é mais fonte de
horário.

## Modelo de dados

### `Turma` (nova, global)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `semestre` | String | `2026.2` |
| `codigo` | String | `ECOB40` |
| `numero` | String | coluna "Turma" do atestado |
| `nome` | String | |
| `docente` | String? | |
| `vigenciaInicio` / `vigenciaFim` | String | |
| `slots` | Json | mesmo `TurmaSlot[]` de hoje |
| `atualizadoEm` | DateTime | |

Única em `(semestre, codigo, numero)`.

O sync faz upsert e **só sobrescreve** nome/docente/slots/vigência quando o
`fetchedAt` do sync é mais recente que o `atualizadoEm` gravado. Sem essa
guarda, um app que ficou offline com dado velho regride a sala para toda a
turma.

Efeito colateral desejável: se um colega sincronizou hoje e a sala mudou, quem
não sincroniza há uma semana já vê a sala nova.

### `Matricula` (nova, junção)

`(userId, turmaId)` como chave primária, mais `ordem` — a posição em que o SIGAA
lista aquela turma para aquele aluno, que é por aluno e não da turma.
Substituída por inteiro a cada sync.

É também a guarda de autorização: toda ação sobre um ponto de atenção exige uma
`Matricula` do usuário naquela turma.

### `PontoAtencao` (nova)

`turmaId`, `responsavelId` (nulável), `tipo` (`PROVA` | `TRABALHO`), `titulo`,
`data`, `hora?`, `observacao?`, `criadoEm`, `atualizadoEm`.

`responsavelId` é uma coluna só, reatribuída na correção — não há registro de
quem criou. Quem corrige assume a responsabilidade e o nome anterior sai do
registro.

`onDelete: SetNull` no responsável: se a conta é apagada, o item sobrevive para
a turma em vez de sumir para trinta pessoas, e passa a ser editável por qualquer
matriculado.

### `PontoAtencaoVoto` (nova)

`(pontoId, userId)` como chave primária, mais `valor` (`CONFIRMA` | `CONTESTA`)
e `criadoEm`. A chave composta já garante um voto por pessoa, sem lógica de
aplicação.

### `CachedTurma` sai

`CachedSchedule` permanece, reduzida ao que só ela tem: período letivo e
`fetchedAt` do aluno.

**Não há migração de dados.** `CachedTurma` não tem `numero`, então a identidade
não é derivável retroativamente. A migração dropa a tabela; o aluno cai no
estado `unsynced` que a home já sabe renderizar, até o próximo sync. É cache.

## Ciclo de vida do item

Três estados, percorridos sem intervenção de ninguém:

**Normal** — só o responsável edita. Aparece no card de contagem regressiva e no
bloco do dia.

**Contestado** — quando `contesta > confirma` **e** `contesta >= 3`. Sai da
contagem regressiva e do bloco do dia, fica apenas na lista completa, apagado,
com o rótulo "N colegas contestaram esta data" e um botão **Corrigir** visível
para qualquer matriculado.

**Corrigido** — alguém edita, o item volta a Normal e quem corrigiu vira o
responsável. Simétrico: quem afirmou o fato novo responde por ele, e o antigo
responsável pode contestar de volta.

O estado **é derivado na leitura**, não é coluna. Nenhum job mantém flag em dia,
e mudar o limiar é mudar uma constante.

### Por que contestar destrava a edição

Restringir a correção ao responsável seria esperar a data certa justamente de
quem já demonstrou não saber. Contestação faz duas coisas: rebaixa (protege o
card de contagem regressiva de uma data errada) e destrava (permite consertar).

### Zeragem de votos

Corrigir zera os votos — as contestações eram sobre a data velha, e mantê-las
faria o item nascer corrigido e já rebaixado, sem nunca sair do buraco.

Zerar em toda edição seria um escape: bastaria trocar uma vírgula na observação
para limpar as contestações. Portanto:

- muda `data` ou `hora` → apaga os votos e transfere a responsabilidade;
- muda `titulo` ou `observacao` → mantém os votos e a responsabilidade.

O que foi contestado é o prazo, e é ele que precisa ser reafirmado.

## API

Toda ação passa pela mesma guarda: existe `Matricula` do usuário naquela turma.

| Método | Rota | Regra |
|---|---|---|
| `GET` | `/pontos-atencao` | itens das turmas matriculadas, por data; traz contagens, o voto do próprio usuário, o estado derivado e se pode editar. `?desde=vencidos` inclui os já passados — a home omite o parâmetro e recebe só `data >= hoje`; a lista completa o envia |
| `POST` | `/pontos-atencao` | `{ turmaId, tipo, titulo, data, hora?, observacao? }` |
| `PATCH` | `/pontos-atencao/:id` | passa se é o responsável, **ou** o item está contestado, **ou** está sem responsável |
| `DELETE` | `/pontos-atencao/:id` | só o responsável |
| `PUT` | `/pontos-atencao/:id/voto` | `{ valor }` |
| `DELETE` | `/pontos-atencao/:id/voto` | desfaz o voto |

`DELETE` é do responsável e de mais ninguém: item ruim de terceiro se resolve
contestando. Delete global seria a única porta do modelo por onde alguém destrói
trabalho alheio sem deixar nada no lugar.

`/schedule` passa a devolver o `id` da turma em cada item — é o que a tela de
cadastro precisa para montar o seletor, sem endpoint novo de "minhas turmas".

### Acesso é derivado do sync

Trancou a matéria: o próximo sync remove a `Matricula` e o aluno para de ver os
pontos daquela turma. O mesmo vale para o fim do semestre, já que o atestado só
lista o período corrente. Nenhuma lógica de expiração é escrita.

## Backend: caminho de escrita

Todo o caminho está atrás de `ScheduleRepository`, em
`src/db/prisma-schedule.repository.ts`. A interface não muda de forma; muda o
corpo.

`salvar` deixa de ser "apaga tudo e recria" e passa a fazer, numa transação:

1. upsert de cada `Turma` pela chave natural, com a guarda de `atualizadoEm`;
2. `deleteMany` das matrículas daquele aluno;
3. `create` das novas, com a `ordem` do SIGAA;
4. upsert do `CachedSchedule` com período letivo e `fetchedAt`.

`buscar` passa a ler `Matricula → Turma` ordenado por `ordem`.

`Turma` (a interface do parser, em `parsers/turma.ts`) ganha `numero: string`,
lido em `parseAtestadoTurmas`.

## Mobile

Quatro superfícies, três novas.

**Home (`HomeTab`)** — a seção de pontos de atenção no topo (card herói de
contagem regressiva + lista "Depois disso") e os prazos intercalados nos blocos
do dia. A grade semanal e o card de próxima aula não mudam. **A grade semanal
não marca prazos** — decisão de produto, não limitação. O item contestado não
aparece em nenhuma das duas superfícies, por definição do estado.

**Lista completa (`/pontos-atencao`)** — destino do "Ver tudo". É onde vivem os
contestados, os de data distante e os já vencidos. Sem ela o estado contestado
não teria onde existir.

**Cadastro/edição (`/ponto-de-atencao/novo` e `/ponto-de-atencao/[id]`)** — os
cinco campos. Chega com `turmaId` preenchido quando vem do bloco da aula, e com
o seletor de turma quando vem do "+" do cabeçalho da seção.

**Estado vazio** — a seção some inteira e dá lugar a uma linha discreta com o
"+": "Nenhuma prova ou trabalho cadastrado". É o único caminho de descoberta de
uma feature cujo conteúdo é todo do usuário.

### Duas funções puras

No mesmo espírito de `lib/sigaa-schedule.ts`:

- **urgência**, a partir da data e do relógio: `danger <= 3 dias`,
  `warning <= 10`, neutro depois. Um lugar só para o limiar, consumido pela
  home, pela lista e pelo bloco do dia.
- **intercalação**, misturando os pontos de uma data com as aulas daquele dia em
  ordem cronológica, tratando prazo sem hora como 23:59.

### Design visual

O canvas com os artboards (home atual, direções B e C, e a direção D escolhida)
está publicado como artifact; os fontes ficam em `.design/home/`. A direção D é
a referência de implementação.

## Testes

**Backend**

- repositório: upsert de turma com sync mais velho (não sobrescreve) e mais novo
  (sobrescreve); substituição de matrículas preservando a `ordem`.
- parser: `numero` lido do atestado; ausência da coluna.
- controller: cada guarda — não matriculado, não responsável, item contestado,
  item órfão.
- serviço: zeragem de votos ao mudar data/hora e preservação ao mudar
  título/observação; cálculo do estado contestado no limiar exato.

**Mobile**

- unidade nas duas funções puras e na leitura do estado contestado.
- RTL seguindo os arquivos de `mobile/src/__tests__`: home com e sem pontos,
  item contestado fora da dobra, formulário com turma pré-preenchida e com
  seletor.

## Riscos

| Risco | Mitigação |
|---|---|
| Postback do atestado falha e o aluno fica sem horário | Aceito. O parser da home permanece para diagnóstico; se a taxa de falha se mostrar alta, reintroduzir o fallback só para horário (sem turma compartilhada) é uma mudança pequena. |
| Sync antigo sobrescreve dados de turma mais novos | Guarda de `atualizadoEm` no upsert. |
| Item errado com poucos alunos na turma (nunca atinge 3 contestações) | Aceito na v1. Se aparecer, o limiar vira função do tamanho da turma. |
| Guerra de edição entre dois alunos | Aceito. A turma é de dezenas de colegas que se conhecem; sem histórico de revisões em v1. |
