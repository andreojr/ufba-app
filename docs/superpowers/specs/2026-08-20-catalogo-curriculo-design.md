# Catálogo de cursos e matérias — design spec

## Motivation

Roadmap item 3. Persistir os cursos da UFBA e as matérias que cada curso
pode cursar, servindo de base para a Trajetória (item 4), a seleção de
optativas (item 5) e os marcos de semestralização (item 8). Hoje o app não
conhece a grade curricular de ninguém — só o que já foi cursado
(`Historico`).

Um spike de viabilidade nesta conversa validou a cadeia inteira sem login:

1. `GET /sigaa/public/curso/lista.jsf` — lista estática com os 284 cursos
   de graduação da UFBA (nome, sede, id), sem paginação.
2. `GET /sigaa/public/curso/portal.jsf?id=X` — perfil do curso, com link
   para currículos.
3. `GET /sigaa/public/curso/curriculo.jsf?id=X` — lista as **estruturas
   curriculares** do curso (ex.: `G20251` "Ativa", mais versões antigas
   "Inativa"). Cada uma é um link JSF-ajax (`jsfcljs`, ViewState).
4. POST encadeado (mesmo padrão de `PublicSigaaSession`, criado para
   professores) → `resumo_curriculo.jsf` — devolve a matriz curricular
   completa: cargas horárias totais, obrigatórias por período (1º ao 12º
   nível), optativas, complementares, cada componente com id/código/nome/
   carga horária.
5. Cada componente na matriz tem um segundo link, ao mesmo endpoint
   (`resumo_curriculo.jsf`, `id` do componente + `publico=public`), que
   devolve o "Resumo do Componente Curricular": unidade responsável,
   pré-requisitos, co-requisitos, equivalências e ementa. **Medido: este
   request não avança o ViewState da conversa** — múltiplos componentes
   foram buscados reaproveitando o mesmo `ViewState`, então são
   paralelizáveis (mesmo padrão de concorrência limitada já usado nos
   perfis de professor), não sequenciais como a busca por nome de docente.

## Scope

**Nesta entrega:** diretório de cursos, resolução sob demanda da estrutura
curricular **Ativa** de um curso, e os componentes dessa estrutura
(obrigatórias por período, optativas, complementares) — incluindo, por
componente, pré-requisito/co-requisito/equivalências **no estado atual**
(sem histórico de vigência).

**Fora de escopo, deliberadamente:**

- **Histórico de vigência** de pré-requisito/equivalência (o SIGAA guarda
  quando cada versão da expressão esteve `ATIVO`/`DESCONSIDERADO`, com
  datas de início/fim). Nada no roadmap atual precisa disso — vira item
  novo quando alguma tela precisar reconstruir "como era a regra na época
  X".
- **Resolver a estrutura curricular exata de cada usuário.** `Historico`
  já persiste `curriculo` (ex.: `"G20251 - 2025.2"`), cujo código bate
  exatamente com o `Código:` da página de estrutura — mas usar sempre a
  **Ativa** foi a decisão explícita para esta entrega. Um aluno numa grade
  antiga vai comparar contra a matriz atual; ajustar isso por equivalência
  fica para um passo posterior no servidor, quando o item 4/8 expuser essa
  necessidade concretamente.
- Ficha completa do componente (ementa, cargas detalhadas por
  modalidade) além do que já vem de graça na mesma página do
  pré-requisito/equivalência.
- Qualquer tela de consumo (itens 4, 5, 8) — esta entrega é só o backend e
  o catálogo.

## Data model

```prisma
// Diretório global dos cursos de graduação da UFBA. Substituído por
// completo a cada refresh — mesmo racional do CachedSchedule: é a
// lista.jsf inteira (284 linhas), sem porquê fazer upsert linha a linha.
model Curso {
  idSigaa      String   @id @map("id_sigaa")
  nome         String
  sede         String
  nivel        String   @default("G")
  atualizadoEm DateTime @default(now()) @map("atualizado_em")

  estruturas EstruturaCurricular[]

  @@map("cursos")
}

// Uma grade específica de um curso (G20251, T20252, 186140...). Buscada
// sob demanda por curso — só quando alguém pede a matriz daquele curso.
// Sempre a estrutura marcada "Ativa" nesta entrega (ver Scope).
model EstruturaCurricular {
  idSigaa                        String   @id @map("id_sigaa")
  cursoId                        String   @map("curso_id")
  codigo                         String   // "G20251" — bate com Historico.curriculo
  anoPeriodoImplementacao        String   @map("ano_periodo_implementacao")
  cargaHorariaTotal              Int      @map("carga_horaria_total")
  cargaHorariaObrigatoria        Int      @map("carga_horaria_obrigatoria")
  cargaHorariaOptativaMinima     Int      @map("carga_horaria_optativa_minima")
  cargaHorariaComplementarMinima Int      @map("carga_horaria_complementar_minima")
  prazoMinimoSemestres           Int      @map("prazo_minimo_semestres")
  prazoMedioSemestres            Int      @map("prazo_medio_semestres")
  prazoMaximoSemestres           Int      @map("prazo_maximo_semestres")

  fetchedAt  DateTime @default(now()) @map("fetched_at")
  staleAfter DateTime @map("stale_after")

  curso       Curso                  @relation(fields: [cursoId], references: [idSigaa])
  componentes ComponenteCurricular[]

  @@unique([cursoId, codigo])
  @@map("estruturas_curriculares")
}

model ComponenteCurricular {
  id                    String  @id @default(uuid())
  estruturaCurricularId String  @map("estrutura_curricular_id")
  idSigaa               String  @map("id_sigaa") // id do componente no SIGAA — usado pra buscar o detalhe
  codigo                String
  nome                  String
  cargaHoraria          Int     @map("carga_horaria")
  natureza              String  // OBRIGATORIA | OPTATIVA | COMPLEMENTAR
  periodo               Int?    // null para optativas/complementares

  // Vêm de graça na mesma página de detalhe do componente — sem custo
  // extra de request.
  unidadeResponsavel String? @map("unidade_responsavel")
  preRequisito       String? @map("pre_requisito") // texto cru: "(FISD36 E FISD42) OU (ENGJ18)"
  coRequisito        String? @map("co_requisito")
  equivalencias      String? @map("equivalencias") // texto cru: "(ENG295A) OU (ENG295B)"

  estruturaCurricular EstruturaCurricular @relation(fields: [estruturaCurricularId], references: [idSigaa], onDelete: Cascade)

  @@unique([estruturaCurricularId, codigo])
  @@map("componentes_curriculares")
}
```

### Por que tabela relacional, não JSON

Diferente de `Docente.disciplinas` (JSON, só exibido), os itens 4 e 8 do
roadmap precisam **somar carga horária por período** e comparar contra o
que o aluno já cursou — consulta estruturada, não só exibição. Segue o
precedente de `Historico`/`HistoricoComponente`.

### Pré-requisito/equivalência como texto cru

Guardar a expressão como veio da página (`"(FISD36 E FISD42) OU (ENGJ18)"`)
em vez de um parser de lógica booleana estruturada. Nada no roadmap atual
precisa *avaliar* a expressão (ex.: "o aluno pode se matricular?") — só
exibir/anotar. Extrair os códigos referenciados (regex simples) fica
disponível como passo futuro barato, se algum dia servir de índice de
dependência entre matérias.

## Backend architecture

### Module layout

Novo módulo Nest `backend/src/curriculo/`:

- `curriculo.module.ts`
- `curriculo.controller.ts`
- `curriculo.service.ts`
- `curriculo.repository.ts` — interface + token, implementação Prisma em
  `backend/src/db/prisma-curriculo.repository.ts`, seguindo o precedente
  de `HistoricoRepository`

Importa `SigaaEngineModule` só pelo `PublicSigaaSession`. Este módulo é o
**segundo consumidor** dessa classe (o primeiro foi `docentes/`), o que já
justifica sua existência isolada sem precisar de extração — mas confirma
que uma futura terceira necessidade de sessão pública deveria olhar pra
extrair a base comum.

### Parsers

Em `sigaa-engine/parsers/`, seguindo a convenção de cheerio +
`__fixtures__/*.html`:

- `curso-lista.ts` — `lista.jsf` → `{idSigaa, nome, sede}[]`
- `curso-estruturas.ts` — `curriculo.jsf` → `{idSigaa, codigo,
  anoPeriodoImplementacao, ativa, jsfParams}[]` — identifica a estrutura
  "Ativa" e captura os parâmetros do POST ajax (`jsfcljs`) daquela linha
- `estrutura-resumo.ts` — resposta do POST em `resumo_curriculo.jsf`
  (clique na estrutura) → cargas horárias totais + lista de componentes
  (`idSigaa`, código, nome, carga horária, natureza, período)
- `componente-resumo.ts` — resposta do POST em `resumo_curriculo.jsf`
  (clique no componente) → unidade responsável, pré-requisito,
  co-requisito, equivalências (todos nullable — o SIGAA imprime `"-"`
  quando vazio)

### Resolution flow

Disparado por `cursoId`, sob demanda:

1. **Garante o diretório `Curso`.** Se vazio ou mais velho que o TTL,
   refaz o `GET lista.jsf` e substitui por completo (mesmo racional do
   `CachedSchedule`).
2. **`curriculo.jsf` do curso** → acha a estrutura marcada "Ativa". Sem
   estrutura ativa → erro tratado (ver Failure handling).
3. **Um `PublicSigaaSession`**, POST encadeado na estrutura ativa →
   `estrutura-resumo` (a matriz completa).
4. **POSTs em paralelo**, mesma sessão/ViewState, um por componente da
   matriz → `componente-resumo`. Teto de concorrência (ex.: 4-8
   simultâneos), mesmo padrão dos GETs de perfil de professor — medido
   que este request não avança o ViewState, então é seguro paralelizar.
5. **Persiste** `EstruturaCurricular` + todos os `ComponenteCurricular`
   por completo (substituição total, mesmo racional de `Historico`), com
   `staleAfter` calculado com jitter (mesma razão do `Docente`: uma leva
   de cursos resolvidos junto não deve expirar toda no mesmo instante).

### API

Todos JWT-guarded (mesma convenção do resto do backend, mesmo a fonte
sendo pública no SIGAA).

**`GET /curriculo/cursos`** — diretório completo (`idSigaa`, nome, sede).
Atualiza o cache se estiver vazio/velho.

**`GET /curriculo/cursos/:cursoId`** — matriz ativa completa daquele
curso (estrutura + componentes). Resolve e persiste sob demanda se
ausente ou vencida. 404 se o `cursoId` não existe no diretório.

**`GET /curriculo/meu-curso`** — conveniência: casa `User.curso` (formato
medido `"NOME/SIGLA - Campus"`, ex.: `"ENGENHARIA DE COMPUTAÇÃO/PGCOMP -
Salvador"`) contra o diretório via nome+sede normalizados, e devolve a
mesma resposta do endpoint acima. Poupa cada consumidor futuro (itens 4,
5, 8) de replicar esse match.

### Failure handling

Uma estrutura sem "Ativa" (não observado ainda, mas possível) não escreve
nada — a resolução falha para aquele curso e o erro é reportado ao
chamador, sem persistir um catálogo parcial ou incorreto.

Um componente cuja busca de detalhe falhar (rede, timeout) não derruba os
demais — o componente é persistido com `preRequisito`/`coRequisito`/
`equivalencias` nulos, e uma nova tentativa de resolução (a próxima vez
que a estrutura for pedida após vencer) tenta de novo.

## Testing

TDD, na ordem em que as peças são construídas.

**Parsers** — fixtures reais capturadas à mão:

- `curso-lista` — recorte da lista de 284 cursos.
- `curso-estruturas` — um curso com estrutura "Ativa" e duas "Inativa".
- `estrutura-resumo` — a matriz completa (obrigatórias por período,
  optativas, complementares, cargas horárias).
- `componente-resumo` — dois casos: um componente com pré-requisito e
  equivalência preenchidos, outro com ambos como `"-"` (o caso vazio,
  para não confundir com "não buscado ainda").

**`CurriculoService`** — repositório fake: cache fresh/stale/miss, curso
sem estrutura ativa, uma falha de componente não derruba os demais.

**Controller** — supertest, guard de autenticação incluído.

Nenhum teste bate no SIGAA real. Fixtures são capturadas uma vez, à mão, e
versionadas.

## Open risks

1. **Rate limits nos endpoints públicos não foram medidos** — mesma
   ressalva já registrada na investigação de professores.
2. **Curso sem estrutura "Ativa"** ainda não foi observado na prática;
   o tratamento acima é best-effort até aparecer um caso real.
3. **Reconciliação de equivalência para quem está em grade antiga** fica
   deliberadamente fora desta entrega — o dado bruto (pré-requisito/
   equivalência atual) é capturado para permitir esse ajuste depois, mas
   o ajuste em si não é implementado agora.
