# Turma Virtual (SIGAA) — Fase 1: espelhar

## Status

Design aprovado, pronto para virar plano de implementação. Escopo: apenas
SIGAA. Moodle e Google Classroom ficam para specs futuras (a conexão de
conta Moodle já existe, mas leitura de conteúdo Moodle não é tratada aqui).

## Motivação

Hoje o SIGAA avisa por e-mail quando o professor posta algo na Turma Virtual
("lousa"). O app não mostra nada disso — só existe a grade agregada de
horários. Esta feature dá ao app uma página própria por turma que espelha o
conteúdo da Turma Virtual: Notícias, Avaliações e cronograma de Tópicos de
aula.

Notificação push (Fase 2) fica fora de escopo: depende de infraestrutura que
não existe hoje (`expo-notifications` no mobile, `@nestjs/schedule` no
backend) e de uma decisão de produto sobre credencial guardada para relogin
em background. Tarefas, Arquivos e Fóruns também ficam fora: o spike de
reconhecimento não encontrou nenhuma turma com conteúdo real nessas seções
neste semestre, então um parser aqui seria escrito sem fixture real — a
mesma trava que hoje mantém `boletim.ts` com `NotImplementedException`.

Insumo primário: [`TURMA_VIRTUAL_INVESTIGATION.md`](../../../TURMA_VIRTUAL_INVESTIGATION.md)
(spike de 19/08/2026, navegação e estruturas HTML confirmadas contra o SIGAA
real). Este documento assume esse spike como lido.

## Decisões

- **Escopo:** só Fase 1 — Notícias (lista + detalhe), Avaliações, Tópicos de
  aula. Somente leitura, sem push.
- **Busca de dados:** sob demanda, sem cache. Cada visita à tela dispara
  scraping fresco do SIGAA. Sem tabelas Prisma novas para persistir
  notícias/avaliações/tópicos.
- **Token da turma (`frontEndIdTurma`):** persistido no banco, capturado pelo
  parser de horários existente. Backend só volta a raspar o portal home se o
  token estiver ausente ou for rejeitado pelo SIGAA.
- **Ponto de entrada no mobile:** toque na turma na grade semanal da Home.
- **Renderização de HTML rico** (corpo das notícias): sanitizado e convertido
  para componentes nativos, não WebView.
- **Formato da API:** um endpoint agregado por turma (não um endpoint por
  seção), porque o gotcha de navegação (seção→seção falha silenciosamente,
  só funciona saindo pela Principal) torna chamadas separadas quase tão
  caras quanto buscar tudo de uma vez. O corpo completo de uma notícia é
  endpoint à parte, buscado só quando o usuário abre a notícia.

## Modelo de dados

Sem novas tabelas de conteúdo. Duas colunas novas em `Turma` (Prisma), ambas
capturadas na sincronização de horários que já existe hoje:

```prisma
model Turma {
  // ...campos existentes
  frontEndIdTurma String?  // token opaco por turma, usado para entrar na Turma Virtual
  idTurmaSigaa    String?  // id numérico (ex. "393380"), pré-requisito da Fase 2 (feed global) — capturado agora para não reabrir o parser depois
}
```

DTOs de resposta da API (não persistidos):

```ts
interface TurmaVirtualFeed {
  noticias: { id: string; titulo: string; data: string; autor: string | null }[];
  avaliacoes: { descricao: string; data: string }[];
  topicos: { titulo: string; periodo: string; conteudoHtml: string | null }[];
}

interface NoticiaDetalhe {
  titulo: string;
  data: string;
  autor: string | null;
  conteudoHtml: string;
}
```

## Backend

### Parsers

Novo diretório `backend/src/sigaa-engine/parsers/turma-virtual/`, um arquivo
por seção (mesmo padrão de `historico.ts`, `atestado-turmas.ts`):

- `entrar-turma.ts` — POST `discente.jsf` com `frontEndIdTurma`. Extrai o
  `j_id_jsp_*` do form dinamicamente (nunca hardcoded — o valor varia por
  deploy do SIGAA, mesma disciplina já aplicada em `portal-menu.ts`). Valida
  que a resposta é de fato a página principal do AVA da turma esperada, não
  uma casca vazia.
- `noticias.ts` — GET `NoticiaTurma/listar.jsf`, parseia `table.listing`
  (título, data, id).
- `noticia-detalhe.ts` — POST `NoticiaTurma/mostrar.jsf` com `id` como campo
  de form (o `?id=` via query renderiza a casca vazia — gotcha confirmado no
  spike). Parseia `ul.form > li` (`<label>Título:</label>`,
  `<label>Data:</label>`) e `td.conteudoNoticia`.
- `avaliacoes.ts` — GET `DataAvaliacao/listar.jsf`.
- `topicos.ts` — GET `Relatorios/timeline.jsf`, parseia `div.topico-aula`
  (`.titulo` + `.conteudotopico`).

Todos os parsers tratam acentos como entidades numéricas (`Not&#237;cias`) —
camada de escape distinta do ISO-8859-1 que `http-client.ts` já resolve.

### Orquestração

`turma-virtual.service.ts` em `sigaa-engine`: login com a sessão do device
(igual ao resto do engine) → `entrar-turma` → `noticias` + `avaliacoes` +
`topicos` em sequência. As três seções são GETs diretos a partir da turma
corrente — não incorrem no gotcha de "seção→seção falha", que só afeta
navegação entre páginas de **conteúdo** distintas partindo uma da outra sem
passar pela Principal.

Erros seguem o padrão já usado em `sigaa.controller.ts` (exceções tipadas).
Se `frontEndIdTurma` estiver ausente, o erro orienta re-sincronizar as
turmas primeiro.

### Endpoints

- `GET /turmas/:id/turma-virtual` → `TurmaVirtualFeed`
- `GET /turmas/:id/turma-virtual/noticias/:noticiaId` → `NoticiaDetalhe`

Ambos exigem a mesma auth/sessão de device usada pelas demais rotas do
sigaa-engine.

## Mobile

### Navegação

Nova rota `mobile/src/app/turma/[id].tsx`, seguindo o padrão de
`professor/[siape].tsx` (rota fina delegando para uma screen). `HomeTab.tsx`
ganha `onPress` nos blocos de turma da grade semanal, navegando para
`/turma/[id]` com os dados que a Home já tem (nome, código, docente) como
params, para renderizar o header instantaneamente sem esperar o fetch.

### Tela (`TurmaVirtualScreen`)

- Header: nome, código, docente (via params de navegação).
- Corpo em feed único, seções em ordem fixa — **Notícias → Avaliações →
  Tópicos de aula** — não misturadas por data (avaliações e tópicos não têm
  timestamp comparável ao de notícias). Seção só aparece se tiver itens
  (evita "Avaliações" vazia nas turmas sem nada, situação real de 5 das 6
  turmas levantadas no spike para outras seções).
- Notícia: card resumido (título, data, autor). Toque abre detalhe, que
  dispara o fetch do corpo sob demanda.
- Corpo da notícia renderizado via biblioteca de HTML→RN (confirmar
  disponibilidade/escolha no `package.json` do mobile na hora de
  implementar; não usar WebView).
- Estado vazio: se as três seções vierem vazias, mensagem única ("Nada por
  aqui ainda") — reflete o estado real do semestre atual.
- Loading/erro seguem o padrão HeroUI Native já usado nas demais telas
  (spinner + retry).
- Sem cache local: fetch fresco a cada visita, coerente com a decisão de
  "sob demanda, sem cache" do backend.

## Erros e edge cases

- `frontEndIdTurma` ausente no banco → backend retorna erro tipado; mobile
  mostra "Sincronize suas turmas antes de abrir" com CTA de sincronização.
- Sessão SIGAA expira em qualquer ponto → mesmo relogin transparente que o
  resto do sigaa-engine já faz com a sessão do device.
- Gotcha de seção→seção: cada parser valida um marcador esperado na página
  recebida (`table.listing` para notícias, `div.topico-aula` para tópicos,
  etc.); na ausência do marcador, lança erro em vez de devolver lista vazia
  disfarçada de "sem conteúdo".
- Turma sem `idTurma`/token (ex. vínculo de pós-graduação, fora do escopo já
  suportado pelo engine) → mesmo tratamento de "não suportado" usado em
  outras partes do sigaa-engine.

## Testes

- **Backend:** fixtures de HTML reais (padrão já usado em
  `parsers/__fixtures__`) para notícias, avaliações e tópicos — o spike já
  levantou as estruturas, falta salvá-las como fixtures. Teste de unidade
  por parser + teste do orquestrador com sessão mockada.
- **Mobile:** RTL para `TurmaVirtualScreen` cobrindo loading, erro, vazio e
  preenchido; teste de navegação da Home até a tela.

## Fora de escopo (Fase 2 e além)

- Notificação push (poll do feed global `#atualizacoes-turma` do portal
  home, dedupe por id numérico de notícia, `expo-notifications`).
- Tarefas, Arquivos, Fóruns — sem fixture real disponível hoje.
- Leitura de conteúdo Moodle (a conexão de conta já existe; consumo de
  turmas/materiais Moodle é spec própria futura).
- Google Classroom — fora de escopo em todo o projeto até aqui.
