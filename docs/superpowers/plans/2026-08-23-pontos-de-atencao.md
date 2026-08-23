# Pontos de Atenção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alunos cadastram provas e trabalhos por turma, e todo mundo matriculado naquela turma vê os prazos na home.

**Architecture:** `Turma` deixa de ser um snapshot por aluno e vira entidade global identificada por `(semestre, codigo, numero)`, ligada aos alunos por uma tabela `Matricula`. Os pontos de atenção penduram na turma, com confirmação/contestação por aluno e um estado derivado na leitura. O caminho de escrita do sync está todo atrás de `ScheduleRepository`, então a troca é contida a um arquivo.

**Tech Stack:** Backend NestJS + Prisma + PostgreSQL, testes em Jest com `PrismaService` mockado. Mobile Expo Router + heroui-native + uniwind, testes em Jest + `@testing-library/react-native` v14.

**Spec:** `docs/superpowers/specs/2026-08-23-pontos-de-atencao-design.md`

## Global Constraints

- Backend: rodar testes com `npm test` dentro de `backend/` (o script já exporta `NODE_OPTIONS=--experimental-vm-modules`).
- Mobile: rodar testes com `npm test` dentro de `mobile/`.
- Nenhum teste de repositório usa banco real — todos mockam `PrismaService`, como em `src/db/prisma-schedule.repository.spec.ts`.
- Datas trafegam como `YYYY-MM-DD` (string) na API. No banco a coluna é `@db.Date`; ao gravar, construir `new Date(\`${data}T00:00:00Z\`)`; ao ler, serializar com `.toISOString().slice(0, 10)`. Nunca `new Date(stringSemHora)` no mobile — usar `parseIsoDate` de `lib/periodo-letivo`.
- Limiar de contestação: `contesta > confirma && contesta >= 3`. Constante única `LIMIAR_CONTESTACAO`.
- Limiares de urgência no mobile: `critico` até 3 dias, `atencao` até 10, `distante` depois. Constante única em `lib/pontos-atencao.ts`.
- Tipos de ponto: exatamente `PROVA` e `TRABALHO`. Valores de voto: exatamente `CONFIRMA` e `CONTESTA`.
- Português nos identificadores de domínio (segue a convenção do repo: `salvar`, `buscar`, `turmas`, `periodoLetivo`).
- Commits pequenos, um por task no mínimo.

## File Structure

**Backend — criados**

| Arquivo | Responsabilidade |
|---|---|
| `src/pontos-atencao/ponto-atencao.repository.ts` | interface + tipos de linha lidos do banco |
| `src/pontos-atencao/ponto-atencao.estado.ts` | função pura do estado derivado + limiar |
| `src/pontos-atencao/ponto-atencao.service.ts` | guardas, zeragem de votos, transferência de responsabilidade |
| `src/pontos-atencao/ponto-atencao.controller.ts` | rotas + serialização |
| `src/pontos-atencao/ponto-atencao.dto.ts` | validação de entrada |
| `src/pontos-atencao/pontos-atencao.module.ts` | wiring |
| `src/db/prisma-ponto-atencao.repository.ts` | implementação Prisma |

**Backend — modificados**

| Arquivo | Mudança |
|---|---|
| `src/sigaa-engine/parsers/turma.ts` | `numero` na interface `Turma`; novo `TurmaPortal` |
| `src/sigaa-engine/parsers/atestado-turmas.ts` | lê `td.turma` |
| `src/sigaa-engine/parsers/turmas-horario.ts` | passa a devolver `TurmaPortal` |
| `src/sigaa-engine/sigaa-engine.service.ts` | remove o fallback do portal |
| `src/sigaa-engine/schedule.repository.ts` | `HorarioSalvo.turmas: TurmaSalva[]` |
| `src/db/prisma-schedule.repository.ts` | upsert de `Turma` + replace de `Matricula` |
| `src/sigaa-engine/schedule.controller.ts` | `id` na resposta |
| `src/db/tokens.ts`, `src/db/database.module.ts`, `src/app.module.ts` | wiring |
| `prisma/schema.prisma` | modelos novos, `CachedTurma` removida |

**Mobile — criados**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/pontos-atencao.ts` | urgência + intercalação (puras) |
| `src/components/PontoAtencaoHero.tsx` | card herói de contagem regressiva |
| `src/components/PontosAtencaoSection.tsx` | seção da home (herói + "Depois disso" + vazio) |
| `src/app/pontos-atencao.tsx` | lista completa |
| `src/app/ponto-de-atencao/novo.tsx` | cadastro |
| `src/app/ponto-de-atencao/[id].tsx` | edição |

**Mobile — modificados**

| Arquivo | Mudança |
|---|---|
| `src/lib/types.ts` | `Turma.id`, `Turma.numero`, tipos de ponto |
| `src/lib/api.ts` | funções de ponto de atenção |
| `src/screens/HomeTab.tsx` | seção no topo + prazos nos blocos do dia |

---

### Task 1: Parser lê o número da turma

**Files:**
- Modify: `backend/src/sigaa-engine/parsers/turma.ts`
- Modify: `backend/src/sigaa-engine/parsers/atestado-turmas.ts:126-136`
- Modify: `backend/src/sigaa-engine/parsers/turmas-horario.ts`
- Test: `backend/src/sigaa-engine/parsers/atestado-turmas.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Turma` com `numero: string`; `TurmaPortal = Omit<Turma, 'numero'>` exportado de `parsers/turma.ts`; `parseAtestadoTurmas` devolve `Turma[]`; `parseTurmasHorario` devolve `TurmaPortal[]`.

- [ ] **Step 1: Write the failing test**

Em `backend/src/sigaa-engine/parsers/atestado-turmas.spec.ts`, junto dos testes existentes:

```typescript
it('lê o número da turma da coluna "Turma"', () => {
  const { turmas } = parseAtestadoTurmas(atestadoHtml);

  // ENGG54 é a linha MATRICULADO do fixture; ECOB40 está INDEFERIDO e é filtrada.
  const engg54 = turmas.find((t) => t.codigo === 'ENGG54');
  expect(engg54?.numero).toBe('02');
});

it('devolve string vazia quando a coluna "Turma" não existe no HTML', () => {
  // Um deploy sem essa coluna não pode derrubar o parser — quem rejeita a
  // sincronização é o engine service (Task 2), com uma mensagem própria.
  const semColuna = atestadoHtml.replace(/<td class="turma">[^<]*<\/td>/g, '');

  const { turmas } = parseAtestadoTurmas(semColuna);

  expect(turmas[0].numero).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- atestado-turmas`
Expected: FAIL — `Property 'numero' does not exist on type 'Turma'`.

- [ ] **Step 3: Add `numero` to the interface**

Em `backend/src/sigaa-engine/parsers/turma.ts`, dentro de `export interface Turma`, logo abaixo de `nome`:

```typescript
  /**
   * A coluna "Turma" do atestado ("02", "16"). Junto com semestre e código,
   * identifica a turma em toda a UFBA — é a chave natural que permite dois
   * alunos da mesma turma compartilharem um registro.
   */
  numero: string;
```

E, no fim do arquivo:

```typescript
/**
 * O que a "Minhas Turmas" da home do portal consegue dizer. Não tem a coluna
 * "Turma", então não identifica uma turma compartilhada — desde a v1 dos
 * pontos de atenção este parser é só diagnóstico, nunca fonte de horário.
 */
export type TurmaPortal = Omit<Turma, 'numero'>;
```

- [ ] **Step 4: Read the cell in the atestado parser**

Em `backend/src/sigaa-engine/parsers/atestado-turmas.ts`, dentro do `turmas.push({...})`, adicionar após a linha `nome:`:

```typescript
      numero: cell.find('td.turma').text().trim(),
```

- [ ] **Step 5: Retype the portal parser**

Em `backend/src/sigaa-engine/parsers/turmas-horario.ts`, trocar o import e a assinatura:

```typescript
import { buildTurmaSlots, TurmaPortal } from './turma';
```

```typescript
export function parseTurmasHorario(html: string): TurmaPortal[] {
```

e trocar a declaração local `const turmas: Turma[] = [];` por `const turmas: TurmaPortal[] = [];`.

- [ ] **Step 6: Run the full parser suite**

Run: `cd backend && npm test -- parsers`
Expected: PASS. Se algum spec construir um `Turma` literal, adicionar `numero: '01'` a ele.

- [ ] **Step 7: Commit**

```bash
git add backend/src/sigaa-engine/parsers
git commit -m "feat(backend): parseia o número da turma no atestado de matrícula"
```

---

### Task 2: Fallback do portal deixa de ser fonte de horário

**Files:**
- Modify: `backend/src/sigaa-engine/sigaa-engine.service.ts:60-86`
- Test: `backend/src/sigaa-engine/sigaa-engine.service.spec.ts`

**Interfaces:**
- Consumes: `parseAtestadoTurmas` da Task 1.
- Produces: `fetchSchedule` lança `SigaaScheduleIndisponivelError` (nova classe exportada do mesmo arquivo) quando o atestado não rende turmas.

- [ ] **Step 1: Write the failing test**

```typescript
it('falha quando uma turma vem sem código ou sem número', async () => {
  const service = criarServiceComAtestado(
    atestadoHtml.replace(/<td class="turma">[^<]*<\/td>/g, '<td class="turma"></td>'),
  );

  await expect(service.fetchSchedule(credenciais)).rejects.toBeInstanceOf(
    SigaaScheduleIndisponivelError,
  );
});

it('falha em vez de cair no portal quando o atestado não rende turmas', async () => {
  // Sessão que responde a home normalmente, mas devolve um atestado vazio.
  const service = criarServiceComAtestado('<html><body></body></html>');

  await expect(service.fetchSchedule(credenciais)).rejects.toBeInstanceOf(
    SigaaScheduleIndisponivelError,
  );
});
```

Adaptar `criarServiceComAtestado` ao helper de sessão falsa que o spec já usa; o ponto do teste é o `rejects`, não a forma do duplo.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- sigaa-engine.service`
Expected: FAIL — hoje resolve com `turmas: []` em vez de rejeitar.

- [ ] **Step 3: Replace the fallback with an error**

Em `backend/src/sigaa-engine/sigaa-engine.service.ts`, antes da classe:

```typescript
/**
 * O atestado de matrícula é a única fonte de horário desde que a turma virou
 * entidade compartilhada: só ele traz código e número da turma, e sem os dois
 * não há como ligar o aluno a uma turma que outros alunos também enxergam.
 * A "Minhas Turmas" da home continua parseável (parseTurmasHorario), mas só
 * para diagnóstico — devolvê-la aqui daria um horário que não se conecta a
 * nada.
 */
export class SigaaScheduleIndisponivelError extends Error {
  constructor(cause?: unknown) {
    super('Não foi possível sincronizar sua conta com o SIGAA.');
    this.name = 'SigaaScheduleIndisponivelError';
    this.cause = cause;
  }
}
```

E substituir o bloco `try/catch` + `return { turmas: parseTurmasHorario(...) }` por:

```typescript
    try {
      const { id, jscookAction } = parseAtestadoMenuPostback(portalHtml);
      const atestadoHtml = await session.postback(PORTAL_HOME_PATH, {
        'menu:form_menu_discente': 'menu:form_menu_discente',
        id,
        jscook_action: jscookAction,
      });
      const { turmas, periodoLetivo } = parseAtestadoTurmas(atestadoHtml);
      // Código e número são a identidade compartilhada da turma. Sem eles o
      // horário até renderizaria, mas não se conectaria a turma nenhuma — é
      // o mesmo motivo pelo qual a home do portal deixou de valer.
      if (
        turmas.length === 0 ||
        turmas.some((turma) => !turma.codigo || !turma.numero)
      ) {
        throw new SigaaScheduleIndisponivelError();
      }
      return { turmas, perfil, periodoLetivo };
    } catch (error) {
      this.logger.warn(
        'Could not read the schedule off the atestado de matrícula',
        error instanceof Error ? error.stack : String(error),
      );
      throw error instanceof SigaaScheduleIndisponivelError
        ? error
        : new SigaaScheduleIndisponivelError(error);
    }
```

Remover o import de `parseTurmasHorario` deste arquivo.

- [ ] **Step 4: Map the error to a 502 in the exception filter**

Em `backend/src/sigaa-engine/sigaa-exception.filter.ts`, adicionar `SigaaScheduleIndisponivelError` ao mapeamento seguindo o padrão que já existe ali, com status `502` e a mensagem da própria exceção.

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- sigaa-engine`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/sigaa-engine
git commit -m "feat(backend): exige o atestado de matrícula para sincronizar o horário"
```

---

### Task 3: Migração do schema

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_turma_global_e_pontos_de_atencao/migration.sql` (gerada pelo CLI)

**Interfaces:**
- Consumes: nada.
- Produces: modelos `Turma`, `Matricula`, `PontoAtencao`, `PontoAtencaoVoto`; `CachedTurma` removida; `CachedSchedule` sem a relação `turmas`.

- [ ] **Step 1: Remove `CachedTurma` and its relation**

Em `backend/prisma/schema.prisma`: apagar o modelo `CachedTurma` inteiro, e em `CachedSchedule` apagar a linha `turmas CachedTurma[]`.

- [ ] **Step 2: Add the four new models**

```prisma
// Global — uma turma é a mesma para todos os alunos nela, ao contrário do
// CachedTurma que isto substitui (aquele era um snapshot por aluno). A chave
// natural vem do atestado de matrícula: 2026.2 / ENGG54 / 02.
model Turma {
  id             String   @id @default(uuid())
  semestre       String
  // Não nulável, ao contrário do CachedTurma que isto substitui: a chave
  // natural precisa dos três, e o Prisma não consulta um @@unique com null.
  // O atestado sempre traz o código — a Task 2 rejeita a sincronização
  // quando não traz.
  codigo         String
  numero         String
  nome           String
  docente        String?
  vigenciaInicio String   @map("vigencia_inicio")
  vigenciaFim    String   @map("vigencia_fim")
  // TurmaSlot[] — mesmo formato do CachedTurma que isto substitui.
  slots          Json
  // Guarda contra regressão: um app offline com dado velho não pode
  // sobrescrever o que um colega sincronizou depois.
  atualizadoEm   DateTime @default(now()) @map("atualizado_em")

  matriculas Matricula[]
  pontos     PontoAtencao[]

  @@unique([semestre, codigo, numero])
  @@map("turmas")
}

// A junção aluno↔turma. Substituída por inteiro a cada sync, e é também a
// guarda de autorização de todo ponto de atenção.
model Matricula {
  userId  String @map("user_id")
  turmaId String @map("turma_id")
  // A posição em que o SIGAA lista a turma para ESTE aluno — por aluno, não
  // da turma, por isso mora aqui e não em Turma.
  ordem   Int

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  turma Turma @relation(fields: [turmaId], references: [id], onDelete: Cascade)

  @@id([userId, turmaId])
  @@unique([userId, ordem])
  @@map("matriculas")
}

// Prova ou trabalho com data marcada, cadastrado por um aluno e visível para
// toda a turma. Não vem do SIGAA: a Turma Virtual não é confiável para prazos.
model PontoAtencao {
  id            String   @id @default(uuid())
  turmaId       String   @map("turma_id")
  // Quem responde pelo item AGORA — reatribuído a quem corrige. Não existe
  // registro de quem criou: quem corrige assume, e o nome anterior sai.
  responsavelId String?  @map("responsavel_id")
  tipo          String // PROVA | TRABALHO
  titulo        String
  data          DateTime @db.Date
  hora          String? // "HH:MM"
  observacao    String?
  criadoEm      DateTime @default(now()) @map("criado_em")
  atualizadoEm  DateTime @updatedAt @map("atualizado_em")

  turma Turma @relation(fields: [turmaId], references: [id], onDelete: Cascade)
  // SetNull, não Cascade: conta apagada não pode fazer o item sumir para as
  // outras trinta pessoas da turma. Sem responsável, o item destrava.
  responsavel User? @relation(fields: [responsavelId], references: [id], onDelete: SetNull)
  votos       PontoAtencaoVoto[]

  @@index([turmaId, data])
  @@map("pontos_atencao")
}

// A chave composta já garante um voto por pessoa — sem lógica de aplicação.
model PontoAtencaoVoto {
  pontoId  String   @map("ponto_id")
  userId   String   @map("user_id")
  valor    String // CONFIRMA | CONTESTA
  criadoEm DateTime @default(now()) @map("criado_em")

  ponto PontoAtencao @relation(fields: [pontoId], references: [id], onDelete: Cascade)
  user  User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([pontoId, userId])
  @@map("pontos_atencao_voto")
}
```

- [ ] **Step 3: Add the back-relations on `User`**

Em `model User`, junto das outras relações:

```prisma
  matriculas       Matricula[]
  pontosAtencao    PontoAtencao[]
  votosPontos      PontoAtencaoVoto[]
```

- [ ] **Step 4: Generate the migration**

Run: `cd backend && npx prisma migrate dev --name turma_global_e_pontos_de_atencao`
Expected: a migração é criada e aplicada; o SQL contém `DROP TABLE "cached_turma"`.

- [ ] **Step 5: Verify the client typechecks**

Run: `cd backend && npx prisma generate && npx tsc --noEmit`
Expected: erros SOMENTE em `src/db/prisma-schedule.repository.ts`, que ainda usa `cachedTurma` — é o que a Task 4 conserta.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma
git commit -m "feat(backend): turma global, matrícula e pontos de atenção no schema"
```

---

### Task 4: Sync grava turma global e matrícula

**Files:**
- Modify: `backend/src/sigaa-engine/schedule.repository.ts`
- Modify: `backend/src/db/prisma-schedule.repository.ts`
- Modify: `backend/src/sigaa-engine/schedule.controller.ts:20-27`
- Test: `backend/src/db/prisma-schedule.repository.spec.ts`

**Interfaces:**
- Consumes: `Turma` com `numero` (Task 1), modelos Prisma (Task 3).
- Produces: `TurmaSalva = Turma & { id: string }` exportada de `schedule.repository.ts`; `HorarioSalvo.turmas: TurmaSalva[]`; `/schedule` devolve `id` em cada turma.

- [ ] **Step 1: Write the failing tests**

Substituir os testes existentes de `salvar` em `backend/src/db/prisma-schedule.repository.spec.ts` por estes (o helper `turmasFalsas()` continua, com `numero: '01'` e `numero: '02'` adicionados às duas turmas):

```typescript
function prismaFalso(overrides: { atualizadoEm?: Date } = {}) {
  const upserts: any[] = [];
  const tx = {
    turma: {
      findUnique: jest.fn(async () =>
        overrides.atualizadoEm ? { id: 'turma-1', atualizadoEm: overrides.atualizadoEm } : null,
      ),
      upsert: jest.fn(async (args: any) => {
        upserts.push(args);
        return { id: 'turma-1' };
      }),
    },
    matricula: {
      deleteMany: jest.fn(async () => undefined),
      createMany: jest.fn(async () => undefined),
    },
    cachedSchedule: { upsert: jest.fn(async () => undefined) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  } as unknown as PrismaService;
  return { prisma, tx, upserts };
}

it('não sobrescreve uma turma que outro aluno sincronizou depois', async () => {
  const { prisma, tx } = prismaFalso({ atualizadoEm: new Date('2026-08-23T12:00:00Z') });

  await new PrismaScheduleRepository(prisma).salvar(
    'user-1',
    turmasFalsas(),
    periodoLetivo,
    new Date('2026-08-23T09:00:00Z'),
  );

  // O upsert acontece (a matrícula precisa do id), mas sem update dos dados.
  expect(tx.turma.upsert.mock.calls[0][0].update).toEqual({});
});

it('sobrescreve quando o sync é mais recente que o registro', async () => {
  const { prisma, tx } = prismaFalso({ atualizadoEm: new Date('2026-08-23T09:00:00Z') });

  await new PrismaScheduleRepository(prisma).salvar(
    'user-1',
    turmasFalsas(),
    periodoLetivo,
    new Date('2026-08-23T12:00:00Z'),
  );

  expect(tx.turma.upsert.mock.calls[0][0].update.nome).toBe('CÁLCULO A');
});

it('substitui as matrículas do aluno preservando a ordem do SIGAA', async () => {
  const { prisma, tx } = prismaFalso();

  await new PrismaScheduleRepository(prisma).salvar(
    'user-1',
    turmasFalsas(),
    periodoLetivo,
    new Date('2026-08-23T12:00:00Z'),
  );

  expect(tx.matricula.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  expect(tx.matricula.createMany.mock.calls[0][0].data.map((m: any) => m.ordem)).toEqual([0, 1]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- prisma-schedule.repository`
Expected: FAIL — `salvar` ainda aceita três argumentos e escreve em `cachedSchedule.turmas`.

- [ ] **Step 3: Widen the repository interface**

Em `backend/src/sigaa-engine/schedule.repository.ts`:

```typescript
import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { Turma } from './parsers/turma';

/** Uma turma já persistida — o `id` é o que a tela de cadastro de pontos usa. */
export type TurmaSalva = Turma & { id: string };

export interface HorarioSalvo {
  turmas: TurmaSalva[];
  periodoLetivo: PeriodoLetivo | null;
  fetchedAt: Date;
}

export interface ScheduleRepository {
  /**
   * Faz upsert das turmas (globais, compartilhadas entre alunos) e substitui
   * as matrículas deste aluno, numa transação. `fetchedAt` decide se os dados
   * da turma sobrescrevem os que já estão lá — ver a guarda de atualizadoEm.
   */
  salvar(
    userId: string,
    turmas: Turma[],
    periodoLetivo: PeriodoLetivo | null,
    fetchedAt: Date,
  ): Promise<void>;

  buscar(userId: string): Promise<HorarioSalvo | null>;
}
```

- [ ] **Step 4: Rewrite the Prisma repository**

Substituir o corpo de `backend/src/db/prisma-schedule.repository.ts` por:

```typescript
import type { Prisma } from '@prisma/client';
import type {
  HorarioSalvo,
  ScheduleRepository,
  TurmaSalva,
} from '../sigaa-engine/schedule.repository';
import type { PeriodoLetivo } from '../sigaa-engine/parsers/atestado-turmas';
import type { Turma, TurmaSlot } from '../sigaa-engine/parsers/turma';
import { PrismaService } from './prisma.service';

export class PrismaScheduleRepository implements ScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async salvar(
    userId: string,
    turmas: Turma[],
    periodoLetivo: PeriodoLetivo | null,
    fetchedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      for (const turma of turmas) {
        // O cast é seguro: o engine service (Task 2) rejeita a sincronização
        // antes de chegar aqui se alguma turma vier sem código. O tipo do
        // parser segue nulável só por causa de parseTurmasHorario.
        const chave = {
          semestre_codigo_numero: {
            semestre: turma.semestre,
            codigo: turma.codigo as string,
            numero: turma.numero,
          },
        };

        const existente = await tx.turma.findUnique({
          where: chave,
          select: { atualizadoEm: true },
        });

        // Um app que ficou offline com dado velho não pode regredir a sala
        // para toda a turma: só escreve quem chegou com dado mais novo.
        const dados = {
          nome: turma.nome,
          docente: turma.docente,
          vigenciaInicio: turma.vigencia.inicio,
          vigenciaFim: turma.vigencia.fim,
          slots: turma.slots as unknown as Prisma.InputJsonValue,
          atualizadoEm: fetchedAt,
        };
        const desatualizada = existente !== null && existente.atualizadoEm >= fetchedAt;

        const { id } = await tx.turma.upsert({
          where: chave,
          create: {
            semestre: turma.semestre,
            codigo: turma.codigo as string,
            numero: turma.numero,
            ...dados,
          },
          update: desatualizada ? {} : dados,
          select: { id: true },
        });
        ids.push(id);
      }

      await tx.matricula.deleteMany({ where: { userId } });
      await tx.matricula.createMany({
        data: ids.map((turmaId, ordem) => ({ userId, turmaId, ordem })),
      });

      await tx.cachedSchedule.upsert({
        where: { userId },
        create: {
          userId,
          periodoLetivoSemestre: periodoLetivo?.semestre ?? null,
          periodoLetivoInicio: periodoLetivo?.inicio ?? null,
          periodoLetivoFim: periodoLetivo?.fim ?? null,
          fetchedAt,
        },
        update: {
          periodoLetivoSemestre: periodoLetivo?.semestre ?? null,
          periodoLetivoInicio: periodoLetivo?.inicio ?? null,
          periodoLetivoFim: periodoLetivo?.fim ?? null,
          fetchedAt,
        },
      });
    });
  }

  async buscar(userId: string): Promise<HorarioSalvo | null> {
    const registro = await this.prisma.cachedSchedule.findUnique({
      where: { userId },
    });

    if (!registro) {
      return null;
    }

    const matriculas = await this.prisma.matricula.findMany({
      where: { userId },
      orderBy: { ordem: 'asc' },
      include: { turma: true },
    });

    return {
      fetchedAt: registro.fetchedAt,
      periodoLetivo: registro.periodoLetivoSemestre
        ? {
            semestre: registro.periodoLetivoSemestre,
            inicio: registro.periodoLetivoInicio as string,
            fim: registro.periodoLetivoFim as string,
          }
        : null,
      turmas: matriculas.map(({ turma }): TurmaSalva => ({
        id: turma.id,
        codigo: turma.codigo,
        numero: turma.numero,
        nome: turma.nome,
        docente: turma.docente,
        slots: turma.slots as unknown as TurmaSlot[],
        vigencia: { inicio: turma.vigenciaInicio, fim: turma.vigenciaFim },
        semestre: turma.semestre,
      })),
    };
  }
}
```

- [ ] **Step 5: Pass `fetchedAt` from the service**

Em `backend/src/sigaa-engine/schedule.service.ts`, no ponto em que `repository.salvar(...)` é chamado, passar um quarto argumento `new Date()` (ou o instante do fetch, se o método já tiver um).

- [ ] **Step 6: Widen the controller response type**

Em `backend/src/sigaa-engine/schedule.controller.ts`, trocar o import de `Turma` por `TurmaSalva` e a união:

```typescript
import type { HorarioSalvo, TurmaSalva } from './schedule.repository';
```

```typescript
export type ScheduleResponse =
  | { sincronizado: false }
  | {
      turmas: TurmaSalva[];
      periodoLetivo: PeriodoLetivo | null;
      fetchedAt: string;
    };
```

`serializar` não muda: `salvo.turmas` já carrega o `id`.

- [ ] **Step 7: Run tests**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: PASS, sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add backend/src
git commit -m "feat(backend): sync grava turma global e substitui as matrículas do aluno"
```

---

### Task 5: Estado derivado do ponto de atenção

**Files:**
- Create: `backend/src/pontos-atencao/ponto-atencao.estado.ts`
- Test: `backend/src/pontos-atencao/ponto-atencao.estado.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `LIMIAR_CONTESTACAO: number`, `type EstadoPonto = 'NORMAL' | 'CONTESTADO'`, `estadoDoPonto(confirmacoes: number, contestacoes: number): EstadoPonto`.

- [ ] **Step 1: Write the failing test**

`backend/src/pontos-atencao/ponto-atencao.estado.spec.ts`:

```typescript
import { estadoDoPonto } from './ponto-atencao.estado';

describe('estadoDoPonto', () => {
  it('é normal sem voto nenhum', () => {
    expect(estadoDoPonto(0, 0)).toBe('NORMAL');
  });

  it('é normal com duas contestações — abaixo do limiar', () => {
    expect(estadoDoPonto(0, 2)).toBe('NORMAL');
  });

  it('vira contestado na terceira contestação', () => {
    expect(estadoDoPonto(0, 3)).toBe('CONTESTADO');
  });

  it('segue normal quando as confirmações empatam com as contestações', () => {
    expect(estadoDoPonto(3, 3)).toBe('NORMAL');
  });

  it('vira contestado quando as contestações passam as confirmações', () => {
    expect(estadoDoPonto(3, 4)).toBe('CONTESTADO');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- ponto-atencao.estado`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the implementation**

`backend/src/pontos-atencao/ponto-atencao.estado.ts`:

```typescript
/**
 * Quantas contestações são necessárias para rebaixar um item, além de
 * superarem as confirmações. Baixo de propósito: a turma tem dezenas de
 * alunos, não milhares, e o pior caso de rebaixar é um item verdadeiro sair
 * da dobra — não um item falso ganhar autoridade.
 */
export const LIMIAR_CONTESTACAO = 3;

export type EstadoPonto = 'NORMAL' | 'CONTESTADO';

/**
 * Derivado na leitura, nunca persistido: não há job mantendo flag em dia, e
 * mudar o limiar é mudar a constante acima.
 */
export function estadoDoPonto(
  confirmacoes: number,
  contestacoes: number,
): EstadoPonto {
  return contestacoes > confirmacoes && contestacoes >= LIMIAR_CONTESTACAO
    ? 'CONTESTADO'
    : 'NORMAL';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- ponto-atencao.estado`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/pontos-atencao
git commit -m "feat(backend): estado contestado derivado das contagens de voto"
```

---

### Task 6: Repositório de pontos de atenção

**Files:**
- Create: `backend/src/pontos-atencao/ponto-atencao.repository.ts`
- Create: `backend/src/db/prisma-ponto-atencao.repository.ts`
- Modify: `backend/src/db/tokens.ts`
- Modify: `backend/src/db/database.module.ts`
- Test: `backend/src/db/prisma-ponto-atencao.repository.spec.ts`

**Interfaces:**
- Consumes: modelos Prisma (Task 3).
- Produces:

```typescript
export interface PontoAtencaoLinha {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: Date;
  hora: string | null;
  observacao: string | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: 'CONFIRMA' | 'CONTESTA' | null;
}

export interface DadosPonto {
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: Date;
  hora: string | null;
  observacao: string | null;
}

export interface PontoAtencaoRepository {
  estaMatriculado(userId: string, turmaId: string): Promise<boolean>;
  listar(userId: string, incluirVencidos: boolean): Promise<PontoAtencaoLinha[]>;
  buscar(id: string, userId: string): Promise<PontoAtencaoLinha | null>;
  criar(turmaId: string, responsavelId: string, dados: DadosPonto): Promise<string>;
  atualizar(id: string, dados: DadosPonto, responsavelId: string, zerarVotos: boolean): Promise<void>;
  apagar(id: string): Promise<void>;
  votar(pontoId: string, userId: string, valor: 'CONFIRMA' | 'CONTESTA'): Promise<void>;
  removerVoto(pontoId: string, userId: string): Promise<void>;
}
```

- [ ] **Step 1: Write the interface file**

Criar `backend/src/pontos-atencao/ponto-atencao.repository.ts` com exatamente os tipos do bloco **Produces** acima, mais este comentário no topo:

```typescript
/**
 * A camada de dados dos pontos de atenção. `PontoAtencaoLinha` já traz as
 * contagens e o voto do próprio usuário porque toda tela precisa dos três
 * juntos — devolver o item cru obrigaria cada chamador a contar votos.
 */
```

- [ ] **Step 2: Write the failing test**

`backend/src/db/prisma-ponto-atencao.repository.spec.ts`:

```typescript
import { PrismaPontoAtencaoRepository } from './prisma-ponto-atencao.repository';
import type { PrismaService } from './prisma.service';

describe('PrismaPontoAtencaoRepository', () => {
  it('conta os votos e destaca o voto do próprio usuário', async () => {
    const prisma = {
      pontoAtencao: {
        findMany: jest.fn(async () => [
          {
            id: 'ponto-1',
            turmaId: 'turma-1',
            tipo: 'PROVA',
            titulo: 'Avaliação I',
            data: new Date('2026-09-22T00:00:00Z'),
            hora: '16:40',
            observacao: null,
            responsavelId: 'user-2',
            responsavel: { id: 'user-2', name: 'Bruno' },
            turma: { codigo: 'ENGG64', nome: 'VISÃO COMPUTACIONAL' },
            votos: [
              { userId: 'user-1', valor: 'CONTESTA' },
              { userId: 'user-3', valor: 'CONFIRMA' },
              { userId: 'user-4', valor: 'CONFIRMA' },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const [linha] = await new PrismaPontoAtencaoRepository(prisma).listar('user-1', false);

    expect(linha.confirmacoes).toBe(2);
    expect(linha.contestacoes).toBe(1);
    expect(linha.meuVoto).toBe('CONTESTA');
    expect(linha.responsavelNome).toBe('Bruno');
    expect(linha.turmaCodigo).toBe('ENGG64');
  });

  it('só apaga os votos quando mandado zerar', async () => {
    const tx = {
      pontoAtencao: { update: jest.fn(async () => undefined) },
      pontoAtencaoVoto: { deleteMany: jest.fn(async () => undefined) },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    } as unknown as PrismaService;

    const repo = new PrismaPontoAtencaoRepository(prisma);
    const dados = {
      tipo: 'PROVA' as const,
      titulo: 'Avaliação I',
      data: new Date('2026-09-22T00:00:00Z'),
      hora: null,
      observacao: null,
    };

    await repo.atualizar('ponto-1', dados, 'user-1', false);
    expect(tx.pontoAtencaoVoto.deleteMany).not.toHaveBeenCalled();

    await repo.atualizar('ponto-1', dados, 'user-1', true);
    expect(tx.pontoAtencaoVoto.deleteMany).toHaveBeenCalledWith({
      where: { pontoId: 'ponto-1' },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- prisma-ponto-atencao`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Write the Prisma implementation**

`backend/src/db/prisma-ponto-atencao.repository.ts`:

```typescript
import type {
  DadosPonto,
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from '../pontos-atencao/ponto-atencao.repository';
import { PrismaService } from './prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paraLinha(registro: any, userId: string): PontoAtencaoLinha {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const votos = registro.votos as { userId: string; valor: string }[];
  return {
    id: registro.id,
    turmaId: registro.turmaId,
    turmaCodigo: registro.turma.codigo,
    turmaNome: registro.turma.nome,
    responsavelId: registro.responsavelId,
    responsavelNome: registro.responsavel?.name ?? null,
    tipo: registro.tipo,
    titulo: registro.titulo,
    data: registro.data,
    hora: registro.hora,
    observacao: registro.observacao,
    confirmacoes: votos.filter((v) => v.valor === 'CONFIRMA').length,
    contestacoes: votos.filter((v) => v.valor === 'CONTESTA').length,
    meuVoto:
      (votos.find((v) => v.userId === userId)?.valor as
        | 'CONFIRMA'
        | 'CONTESTA'
        | undefined) ?? null,
  };
}

const INCLUDE = {
  turma: { select: { codigo: true, nome: true } },
  responsavel: { select: { id: true, name: true } },
  votos: { select: { userId: true, valor: true } },
} as const;

export class PrismaPontoAtencaoRepository implements PontoAtencaoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async estaMatriculado(userId: string, turmaId: string): Promise<boolean> {
    const matricula = await this.prisma.matricula.findUnique({
      where: { userId_turmaId: { userId, turmaId } },
      select: { turmaId: true },
    });
    return matricula !== null;
  }

  async listar(
    userId: string,
    incluirVencidos: boolean,
  ): Promise<PontoAtencaoLinha[]> {
    // Hoje ao meio-dia UTC evita que o fuso do servidor esconda o item de
    // hoje: a coluna é DATE, gravada como meia-noite UTC.
    const hoje = new Date();
    hoje.setUTCHours(0, 0, 0, 0);

    const registros = await this.prisma.pontoAtencao.findMany({
      where: {
        turma: { matriculas: { some: { userId } } },
        ...(incluirVencidos ? {} : { data: { gte: hoje } }),
      },
      orderBy: { data: 'asc' },
      include: INCLUDE,
    });

    return registros.map((registro) => paraLinha(registro, userId));
  }

  async buscar(id: string, userId: string): Promise<PontoAtencaoLinha | null> {
    const registro = await this.prisma.pontoAtencao.findUnique({
      where: { id },
      include: INCLUDE,
    });
    return registro ? paraLinha(registro, userId) : null;
  }

  async criar(
    turmaId: string,
    responsavelId: string,
    dados: DadosPonto,
  ): Promise<string> {
    const { id } = await this.prisma.pontoAtencao.create({
      data: { turmaId, responsavelId, ...dados },
      select: { id: true },
    });
    return id;
  }

  async atualizar(
    id: string,
    dados: DadosPonto,
    responsavelId: string,
    zerarVotos: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.pontoAtencao.update({
        where: { id },
        data: { ...dados, responsavelId },
      });
      if (zerarVotos) {
        await tx.pontoAtencaoVoto.deleteMany({ where: { pontoId: id } });
      }
    });
  }

  async apagar(id: string): Promise<void> {
    await this.prisma.pontoAtencao.delete({ where: { id } });
  }

  async votar(
    pontoId: string,
    userId: string,
    valor: 'CONFIRMA' | 'CONTESTA',
  ): Promise<void> {
    await this.prisma.pontoAtencaoVoto.upsert({
      where: { pontoId_userId: { pontoId, userId } },
      create: { pontoId, userId, valor },
      update: { valor },
    });
  }

  async removerVoto(pontoId: string, userId: string): Promise<void> {
    await this.prisma.pontoAtencaoVoto.deleteMany({
      where: { pontoId, userId },
    });
  }
}
```

- [ ] **Step 5: Wire the token and the provider**

Em `backend/src/db/tokens.ts`:

```typescript
export const PONTO_ATENCAO_REPOSITORY = Symbol('PONTO_ATENCAO_REPOSITORY');
```

Em `backend/src/db/database.module.ts`, importar `PrismaPontoAtencaoRepository` e `PONTO_ATENCAO_REPOSITORY`, e adicionar em `providers` **e** em `exports`:

```typescript
    {
      provide: PONTO_ATENCAO_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new PrismaPontoAtencaoRepository(prisma),
    },
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- prisma-ponto-atencao && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src
git commit -m "feat(backend): repositório de pontos de atenção"
```

---

### Task 7: Serviço com as guardas e a transferência de responsabilidade

**Files:**
- Create: `backend/src/pontos-atencao/ponto-atencao.service.ts`
- Test: `backend/src/pontos-atencao/ponto-atencao.service.spec.ts`

**Interfaces:**
- Consumes: `PontoAtencaoRepository` (Task 6), `estadoDoPonto` (Task 5).
- Produces: `PontoAtencaoService` com `listar`, `criar`, `atualizar`, `apagar`, `votar`, `removerVoto`, e o tipo `PontoAtencaoVisao = PontoAtencaoLinha & { estado: EstadoPonto; podeEditar: boolean; podeApagar: boolean }`.

- [ ] **Step 1: Write the failing tests**

`backend/src/pontos-atencao/ponto-atencao.service.spec.ts`:

```typescript
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PontoAtencaoService } from './ponto-atencao.service';
import type {
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from './ponto-atencao.repository';

function linha(overrides: Partial<PontoAtencaoLinha> = {}): PontoAtencaoLinha {
  return {
    id: 'ponto-1',
    turmaId: 'turma-1',
    turmaCodigo: 'ENGG64',
    turmaNome: 'VISÃO COMPUTACIONAL',
    responsavelId: 'user-2',
    responsavelNome: 'Bruno',
    tipo: 'PROVA',
    titulo: 'Avaliação I',
    data: new Date('2026-09-22T00:00:00Z'),
    hora: '16:40',
    observacao: null,
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    ...overrides,
  };
}

function repositorioFalso(
  overrides: Partial<PontoAtencaoRepository> = {},
): jest.Mocked<PontoAtencaoRepository> {
  return {
    estaMatriculado: jest.fn(async () => true),
    listar: jest.fn(async () => []),
    buscar: jest.fn(async () => linha()),
    criar: jest.fn(async () => 'ponto-1'),
    atualizar: jest.fn(async () => undefined),
    apagar: jest.fn(async () => undefined),
    votar: jest.fn(async () => undefined),
    removerVoto: jest.fn(async () => undefined),
    ...overrides,
  } as jest.Mocked<PontoAtencaoRepository>;
}

const DADOS = {
  tipo: 'PROVA' as const,
  titulo: 'Avaliação I',
  data: '2026-09-22',
  hora: '16:40',
  observacao: null,
};

describe('PontoAtencaoService', () => {
  it('recusa criar em turma na qual o usuário não está matriculado', async () => {
    const repo = repositorioFalso({ estaMatriculado: jest.fn(async () => false) });

    await expect(
      new PontoAtencaoService(repo).criar('user-1', 'turma-1', DADOS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa edição de item normal por quem não é o responsável', async () => {
    const repo = repositorioFalso();

    await expect(
      new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite edição por qualquer matriculado quando o item está contestado', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(async () => linha({ confirmacoes: 0, contestacoes: 3 })),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS);

    expect(repo.atualizar).toHaveBeenCalled();
  });

  it('permite edição quando o item ficou sem responsável', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(async () => linha({ responsavelId: null, responsavelNome: null })),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', DADOS);

    expect(repo.atualizar).toHaveBeenCalled();
  });

  it('zera os votos e transfere a responsabilidade quando a data muda', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(async () => linha({ responsavelId: 'user-1' })),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', {
      ...DADOS,
      data: '2026-09-29',
    });

    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      expect.anything(),
      'user-1',
      true,
    );
  });

  it('preserva os votos quando só a observação muda', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(async () => linha({ responsavelId: 'user-1' })),
    });

    await new PontoAtencaoService(repo).atualizar('user-1', 'ponto-1', {
      ...DADOS,
      observacao: 'levar calculadora',
    });

    expect(repo.atualizar).toHaveBeenCalledWith(
      'ponto-1',
      expect.anything(),
      'user-1',
      false,
    );
  });

  it('recusa apagar item de outra pessoa mesmo estando contestado', async () => {
    const repo = repositorioFalso({
      buscar: jest.fn(async () => linha({ contestacoes: 5 })),
    });

    await expect(
      new PontoAtencaoService(repo).apagar('user-1', 'ponto-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('responde 404 para item que não existe', async () => {
    const repo = repositorioFalso({ buscar: jest.fn(async () => null) });

    await expect(
      new PontoAtencaoService(repo).apagar('user-1', 'ponto-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- ponto-atencao.service`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the service**

`backend/src/pontos-atencao/ponto-atencao.service.ts`:

```typescript
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { estadoDoPonto, type EstadoPonto } from './ponto-atencao.estado';
import type {
  DadosPonto,
  PontoAtencaoLinha,
  PontoAtencaoRepository,
} from './ponto-atencao.repository';

/** O que chega do cliente: `data` como YYYY-MM-DD, nunca um Date. */
export interface EntradaPonto {
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: string;
  hora: string | null;
  observacao: string | null;
}

export type PontoAtencaoVisao = PontoAtencaoLinha & {
  estado: EstadoPonto;
  podeEditar: boolean;
  podeApagar: boolean;
};

/**
 * A coluna é DATE. Construir com `new Date('2026-09-22')` já dá meia-noite
 * UTC, mas o sufixo explícito evita depender desse detalhe do parser.
 */
function paraData(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function paraDados(entrada: EntradaPonto): DadosPonto {
  return {
    tipo: entrada.tipo,
    titulo: entrada.titulo,
    data: paraData(entrada.data),
    hora: entrada.hora,
    observacao: entrada.observacao,
  };
}

export class PontoAtencaoService {
  constructor(private readonly repository: PontoAtencaoRepository) {}

  private visao(linha: PontoAtencaoLinha, userId: string): PontoAtencaoVisao {
    const estado = estadoDoPonto(linha.confirmacoes, linha.contestacoes);
    return {
      ...linha,
      estado,
      // Contestado destrava a edição: esperar a data certa de quem já errou é
      // esperar de quem demonstrou não saber. Item órfão destrava pelo mesmo
      // motivo — não há mais ninguém para responder por ele.
      podeEditar:
        linha.responsavelId === userId ||
        linha.responsavelId === null ||
        estado === 'CONTESTADO',
      // Apagar é só do responsável em qualquer estado: é a única porta por
      // onde alguém destruiria trabalho alheio sem deixar nada no lugar.
      podeApagar: linha.responsavelId === userId,
    };
  }

  private async exigirMatricula(userId: string, turmaId: string): Promise<void> {
    if (!(await this.repository.estaMatriculado(userId, turmaId))) {
      throw new ForbiddenException('Você não está matriculado nesta turma.');
    }
  }

  private async exigirPonto(
    userId: string,
    id: string,
  ): Promise<PontoAtencaoVisao> {
    const linha = await this.repository.buscar(id, userId);
    if (!linha) {
      throw new NotFoundException('Ponto de atenção não encontrado.');
    }
    await this.exigirMatricula(userId, linha.turmaId);
    return this.visao(linha, userId);
  }

  async listar(
    userId: string,
    incluirVencidos: boolean,
  ): Promise<PontoAtencaoVisao[]> {
    const linhas = await this.repository.listar(userId, incluirVencidos);
    return linhas.map((linha) => this.visao(linha, userId));
  }

  async criar(
    userId: string,
    turmaId: string,
    entrada: EntradaPonto,
  ): Promise<PontoAtencaoVisao> {
    await this.exigirMatricula(userId, turmaId);
    const id = await this.repository.criar(turmaId, userId, paraDados(entrada));
    return this.exigirPonto(userId, id);
  }

  async atualizar(
    userId: string,
    id: string,
    entrada: EntradaPonto,
  ): Promise<PontoAtencaoVisao> {
    const atual = await this.exigirPonto(userId, id);
    if (!atual.podeEditar) {
      throw new ForbiddenException('Este item só pode ser editado por quem responde por ele.');
    }

    // O que foi contestado é o prazo, então é ele que precisa ser reafirmado.
    // Zerar em toda edição seria um escape: bastaria mexer na observação para
    // limpar as contestações.
    const prazoMudou =
      atual.data.toISOString().slice(0, 10) !== entrada.data ||
      atual.hora !== entrada.hora;

    await this.repository.atualizar(id, paraDados(entrada), userId, prazoMudou);
    return this.exigirPonto(userId, id);
  }

  async apagar(userId: string, id: string): Promise<void> {
    const atual = await this.exigirPonto(userId, id);
    if (!atual.podeApagar) {
      throw new ForbiddenException('Só quem responde pelo item pode apagá-lo.');
    }
    await this.repository.apagar(id);
  }

  async votar(
    userId: string,
    id: string,
    valor: 'CONFIRMA' | 'CONTESTA',
  ): Promise<PontoAtencaoVisao> {
    await this.exigirPonto(userId, id);
    await this.repository.votar(id, userId, valor);
    return this.exigirPonto(userId, id);
  }

  async removerVoto(userId: string, id: string): Promise<PontoAtencaoVisao> {
    await this.exigirPonto(userId, id);
    await this.repository.removerVoto(id, userId);
    return this.exigirPonto(userId, id);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- ponto-atencao.service`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/pontos-atencao
git commit -m "feat(backend): serviço de pontos de atenção com guardas e zeragem de votos"
```

---

### Task 8: Controller, DTOs e wiring

**Files:**
- Create: `backend/src/pontos-atencao/ponto-atencao.dto.ts`
- Create: `backend/src/pontos-atencao/ponto-atencao.controller.ts`
- Create: `backend/src/pontos-atencao/pontos-atencao.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/pontos-atencao/ponto-atencao.controller.spec.ts`

**Interfaces:**
- Consumes: `PontoAtencaoService` (Task 7), `PONTO_ATENCAO_REPOSITORY` (Task 6).
- Produces: rotas `GET/POST /pontos-atencao`, `PATCH/DELETE /pontos-atencao/:id`, `PUT/DELETE /pontos-atencao/:id/voto`; tipo `PontoAtencaoResponse`.

- [ ] **Step 1: Write the DTOs**

`backend/src/pontos-atencao/ponto-atencao.dto.ts` (seguir o estilo de `sigaa-credentials.dto.ts`, com `class-validator`):

```typescript
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CriarPontoAtencaoDto {
  @IsString()
  turmaId!: string;

  @IsIn(['PROVA', 'TRABALHO'])
  tipo!: 'PROVA' | 'TRABALHO';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  titulo!: string;

  /** YYYY-MM-DD; a hora, quando existe, vem separada. */
  @IsISO8601({ strict: true })
  data!: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  observacao?: string;
}

export class AtualizarPontoAtencaoDto {
  @IsIn(['PROVA', 'TRABALHO'])
  tipo!: 'PROVA' | 'TRABALHO';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  titulo!: string;

  @IsISO8601({ strict: true })
  data!: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  observacao?: string;
}

export class VotarDto {
  @IsIn(['CONFIRMA', 'CONTESTA'])
  valor!: 'CONFIRMA' | 'CONTESTA';
}
```

- [ ] **Step 2: Write the failing controller test**

`backend/src/pontos-atencao/ponto-atencao.controller.spec.ts`:

```typescript
import { PontoAtencaoController } from './ponto-atencao.controller';
import type { PontoAtencaoService, PontoAtencaoVisao } from './ponto-atencao.service';

const visao: PontoAtencaoVisao = {
  id: 'ponto-1',
  turmaId: 'turma-1',
  turmaCodigo: 'ENGG64',
  turmaNome: 'VISÃO COMPUTACIONAL',
  responsavelId: 'user-2',
  responsavelNome: 'Bruno',
  tipo: 'PROVA',
  titulo: 'Avaliação I',
  data: new Date('2026-09-22T00:00:00Z'),
  hora: '16:40',
  observacao: null,
  confirmacoes: 2,
  contestacoes: 0,
  meuVoto: null,
  estado: 'NORMAL',
  podeEditar: false,
  podeApagar: false,
};

const usuario = { userId: 'user-1', email: 'a@b.c' };

describe('PontoAtencaoController', () => {
  it('serializa a data como YYYY-MM-DD e não vaza o id do responsável', async () => {
    const service = {
      listar: jest.fn(async () => [visao]),
    } as unknown as PontoAtencaoService;

    const [item] = await new PontoAtencaoController(service).listar(usuario as never, undefined);

    expect(item.data).toBe('2026-09-22');
    expect(item.responsavel).toEqual({ nome: 'Bruno' });
    expect('responsavelId' in item).toBe(false);
  });

  it('só inclui vencidos quando o parâmetro pede', async () => {
    const service = { listar: jest.fn(async () => []) } as unknown as PontoAtencaoService;
    const controller = new PontoAtencaoController(service);

    await controller.listar(usuario as never, undefined);
    expect(service.listar).toHaveBeenLastCalledWith('user-1', false);

    await controller.listar(usuario as never, 'vencidos');
    expect(service.listar).toHaveBeenLastCalledWith('user-1', true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- ponto-atencao.controller`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Write the controller**

`backend/src/pontos-atencao/ponto-atencao.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import {
  AtualizarPontoAtencaoDto,
  CriarPontoAtencaoDto,
  VotarDto,
} from './ponto-atencao.dto';
import type { PontoAtencaoService, PontoAtencaoVisao } from './ponto-atencao.service';

/**
 * O id do responsável não sai daqui — a tela mostra o nome, e devolver o id
 * só daria a um cliente a chance de cruzar autoria entre turmas.
 */
export interface PontoAtencaoResponse {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: string;
  hora: string | null;
  observacao: string | null;
  responsavel: { nome: string } | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: 'CONFIRMA' | 'CONTESTA' | null;
  estado: 'NORMAL' | 'CONTESTADO';
  podeEditar: boolean;
  podeApagar: boolean;
}

function serializar(visao: PontoAtencaoVisao): PontoAtencaoResponse {
  return {
    id: visao.id,
    turmaId: visao.turmaId,
    turmaCodigo: visao.turmaCodigo,
    turmaNome: visao.turmaNome,
    tipo: visao.tipo,
    titulo: visao.titulo,
    data: visao.data.toISOString().slice(0, 10),
    hora: visao.hora,
    observacao: visao.observacao,
    responsavel: visao.responsavelNome ? { nome: visao.responsavelNome } : null,
    confirmacoes: visao.confirmacoes,
    contestacoes: visao.contestacoes,
    meuVoto: visao.meuVoto,
    estado: visao.estado,
    podeEditar: visao.podeEditar,
    podeApagar: visao.podeApagar,
  };
}

@Controller('pontos-atencao')
@UseGuards(JwtAuthGuard)
export class PontoAtencaoController {
  constructor(private readonly service: PontoAtencaoService) {}

  @Get()
  async listar(
    @CurrentUser() user: RequestUser,
    @Query('desde') desde: string | undefined,
  ): Promise<PontoAtencaoResponse[]> {
    const visoes = await this.service.listar(user.userId, desde === 'vencidos');
    return visoes.map(serializar);
  }

  @Post()
  async criar(
    @CurrentUser() user: RequestUser,
    @Body() dto: CriarPontoAtencaoDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(
      await this.service.criar(user.userId, dto.turmaId, {
        tipo: dto.tipo,
        titulo: dto.titulo,
        data: dto.data,
        hora: dto.hora ?? null,
        observacao: dto.observacao ?? null,
      }),
    );
  }

  @Patch(':id')
  async atualizar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AtualizarPontoAtencaoDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(
      await this.service.atualizar(user.userId, id, {
        tipo: dto.tipo,
        titulo: dto.titulo,
        data: dto.data,
        hora: dto.hora ?? null,
        observacao: dto.observacao ?? null,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async apagar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.apagar(user.userId, id);
  }

  @Put(':id/voto')
  async votar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: VotarDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(await this.service.votar(user.userId, id, dto.valor));
  }

  @Delete(':id/voto')
  async removerVoto(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PontoAtencaoResponse> {
    return serializar(await this.service.removerVoto(user.userId, id));
  }
}
```

- [ ] **Step 5: Write the module**

`backend/src/pontos-atencao/pontos-atencao.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../db/database.module';
import { PONTO_ATENCAO_REPOSITORY } from '../db/tokens';
import { PontoAtencaoController } from './ponto-atencao.controller';
import type { PontoAtencaoRepository } from './ponto-atencao.repository';
import { PontoAtencaoService } from './ponto-atencao.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PontoAtencaoController],
  providers: [
    {
      provide: PontoAtencaoService,
      inject: [PONTO_ATENCAO_REPOSITORY],
      useFactory: (repository: PontoAtencaoRepository) =>
        new PontoAtencaoService(repository),
    },
  ],
})
export class PontosAtencaoModule {}
```

E registrar `PontosAtencaoModule` em `imports` de `backend/src/app.module.ts`.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src
git commit -m "feat(backend): endpoints de pontos de atenção"
```

---

### Task 9: Tipos e chamadas de API no mobile

**Files:**
- Modify: `mobile/src/lib/types.ts:46-92`
- Modify: `mobile/src/lib/api.ts`
- Test: `mobile/src/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `PontoAtencaoResponse` (Task 8), `TurmaSalva` (Task 4).
- Produces: `Turma` com `id` e `numero`; `PontoAtencao`, `TipoPonto`, `ValorVoto`, `EntradaPonto`; funções `getPontosAtencao`, `postPontoAtencao`, `patchPontoAtencao`, `deletePontoAtencao`, `putVotoPontoAtencao`, `deleteVotoPontoAtencao`.

- [ ] **Step 1: Add the types**

Em `mobile/src/lib/types.ts`, dentro de `export interface Turma`, adicionar no topo:

```typescript
  /** Identidade compartilhada da turma — é o que liga um ponto de atenção a ela. */
  id: string;
  /** A coluna "Turma" do atestado ("02"), parte da chave natural. */
  numero: string;
```

E, ao fim do arquivo:

```typescript
export type TipoPonto = "PROVA" | "TRABALHO";
export type ValorVoto = "CONFIRMA" | "CONTESTA";

/**
 * Um prazo cadastrado por um aluno e visível para a turma inteira. `estado`
 * vem derivado do backend: CONTESTADO sai da contagem regressiva e do bloco
 * do dia, e só aparece na lista completa.
 */
export interface PontoAtencao {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  tipo: TipoPonto;
  titulo: string;
  /** YYYY-MM-DD — usar parseIsoDate, nunca new Date(string). */
  data: string;
  hora: string | null;
  observacao: string | null;
  responsavel: { nome: string } | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: ValorVoto | null;
  estado: "NORMAL" | "CONTESTADO";
  podeEditar: boolean;
  podeApagar: boolean;
}

export interface EntradaPonto {
  tipo: TipoPonto;
  titulo: string;
  data: string;
  hora?: string;
  observacao?: string;
}
```

- [ ] **Step 2: Write the failing test**

Em `mobile/src/__tests__/api.test.ts`, seguindo o padrão de mock de `fetch` que o arquivo já usa:

```typescript
it("pede os vencidos só quando mandado", async () => {
  const fetchMock = mockFetchOk([]);

  await getPontosAtencao("token", { incluirVencidos: false });
  expect(fetchMock.mock.calls[0][0]).toContain("/pontos-atencao");
  expect(fetchMock.mock.calls[0][0]).not.toContain("desde=");

  await getPontosAtencao("token", { incluirVencidos: true });
  expect(fetchMock.mock.calls[1][0]).toContain("/pontos-atencao?desde=vencidos");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npm test -- api`
Expected: FAIL — `getPontosAtencao` não existe.

- [ ] **Step 4: Add the API functions**

Em `mobile/src/lib/api.ts`, junto das demais, e adicionando `EntradaPonto`, `PontoAtencao` e `ValorVoto` ao bloco de import de `./types`:

```typescript
export async function getPontosAtencao(
  accessToken: string,
  options: { incluirVencidos: boolean },
): Promise<PontoAtencao[]> {
  const query = options.incluirVencidos ? "?desde=vencidos" : "";
  return request<PontoAtencao[]>(`/pontos-atencao${query}`, {
    method: "GET",
    accessToken,
  });
}

export async function postPontoAtencao(
  accessToken: string,
  turmaId: string,
  entrada: EntradaPonto,
): Promise<PontoAtencao> {
  return request<PontoAtencao>("/pontos-atencao", {
    method: "POST",
    accessToken,
    body: { turmaId, ...entrada },
  });
}

export async function patchPontoAtencao(
  accessToken: string,
  id: string,
  entrada: EntradaPonto,
): Promise<PontoAtencao> {
  return request<PontoAtencao>(`/pontos-atencao/${id}`, {
    method: "PATCH",
    accessToken,
    body: entrada,
  });
}

export async function deletePontoAtencao(
  accessToken: string,
  id: string,
): Promise<void> {
  return request<void>(`/pontos-atencao/${id}`, { method: "DELETE", accessToken });
}

export async function putVotoPontoAtencao(
  accessToken: string,
  id: string,
  valor: ValorVoto,
): Promise<PontoAtencao> {
  return request<PontoAtencao>(`/pontos-atencao/${id}/voto`, {
    method: "PUT",
    accessToken,
    body: { valor },
  });
}

export async function deleteVotoPontoAtencao(
  accessToken: string,
  id: string,
): Promise<PontoAtencao> {
  return request<PontoAtencao>(`/pontos-atencao/${id}/voto`, {
    method: "DELETE",
    accessToken,
  });
}
```

- [ ] **Step 5: Run tests**

Run: `cd mobile && npm test -- api && npx tsc --noEmit`
Expected: PASS. Se algum teste montar um `Turma` literal, adicionar `id: "turma-1"` e `numero: "01"`.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib
git commit -m "feat(mobile): tipos e chamadas de API dos pontos de atenção"
```

---

### Task 10: Funções puras de urgência e intercalação

**Files:**
- Create: `mobile/src/lib/pontos-atencao.ts`
- Test: `mobile/src/lib/pontos-atencao.test.ts`

**Interfaces:**
- Consumes: `PontoAtencao` (Task 9), `ScheduleBlock` de `lib/sigaa-schedule`.
- Produces: `Urgencia`, `diasAte`, `classificarUrgencia`, `ItemDoDia`, `intercalarDia`.

- [ ] **Step 1: Write the failing test**

`mobile/src/lib/pontos-atencao.test.ts`:

```typescript
import { classificarUrgencia, diasAte, intercalarDia } from "./pontos-atencao";
import type { PontoAtencao } from "./types";
import type { ScheduleBlock } from "./sigaa-schedule";

const AGORA = new Date(2026, 7, 24, 16, 0); // seg 24/08/2026, hora local

function ponto(overrides: Partial<PontoAtencao> = {}): PontoAtencao {
  return {
    id: "p1",
    turmaId: "t1",
    turmaCodigo: "ENGG54",
    turmaNome: "LABORATÓRIO INTEGRADO III-A",
    tipo: "TRABALHO",
    titulo: "Relatório final",
    data: "2026-08-27",
    hora: null,
    observacao: null,
    responsavel: { nome: "Ana" },
    confirmacoes: 0,
    contestacoes: 0,
    meuVoto: null,
    estado: "NORMAL",
    podeEditar: false,
    podeApagar: false,
    ...overrides,
  };
}

function aula(inicioMin: number): ScheduleBlock {
  return {
    key: `a-${inicioMin}`,
    codigo: "ENGG67",
    nome: "SISTEMAS DIGITAIS",
    inicioMin,
    fimMin: inicioMin + 110,
    predio: "ENG",
    sala: "7.1.4",
    localOriginal: "ENG",
    colorIndex: 3,
  };
}

describe("diasAte", () => {
  it("conta dias de calendário, não janelas de 24h", () => {
    // 16h de segunda até quinta é menos de 72h, mas são 3 dias de calendário.
    expect(diasAte("2026-08-27", AGORA)).toBe(3);
  });

  it("é zero no próprio dia", () => {
    expect(diasAte("2026-08-24", AGORA)).toBe(0);
  });

  it("é negativo depois de vencido", () => {
    expect(diasAte("2026-08-21", AGORA)).toBe(-3);
  });
});

describe("classificarUrgencia", () => {
  it("é crítico até três dias", () => {
    expect(classificarUrgencia(0)).toBe("critico");
    expect(classificarUrgencia(3)).toBe("critico");
  });

  it("é atenção até dez dias", () => {
    expect(classificarUrgencia(4)).toBe("atencao");
    expect(classificarUrgencia(10)).toBe("atencao");
  });

  it("é distante depois disso", () => {
    expect(classificarUrgencia(11)).toBe("distante");
  });
});

describe("intercalarDia", () => {
  it("põe o prazo sem hora no fim do dia", () => {
    const itens = intercalarDia([aula(1000)], [ponto()]);

    expect(itens.map((i) => i.kind)).toEqual(["aula", "ponto"]);
    expect(itens[1].inicioMin).toBe(23 * 60 + 59);
  });

  it("põe o prazo com hora na posição cronológica certa", () => {
    const itens = intercalarDia([aula(1000), aula(1110)], [ponto({ hora: "17:00" })]);

    expect(itens.map((i) => i.kind)).toEqual(["aula", "ponto", "aula"]);
  });

  it("ignora item contestado", () => {
    const itens = intercalarDia([aula(1000)], [ponto({ estado: "CONTESTADO" })]);

    expect(itens.map((i) => i.kind)).toEqual(["aula"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- pontos-atencao`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the implementation**

`mobile/src/lib/pontos-atencao.ts`:

```typescript
import { parseIsoDate } from "./periodo-letivo";
import type { ScheduleBlock } from "./sigaa-schedule";
import type { PontoAtencao } from "./types";

/**
 * Os limiares de urgência vivem só aqui — a home, a lista completa e o bloco
 * do dia leem desta função, então mudar a régua é mudar um lugar.
 */
export type Urgencia = "critico" | "atencao" | "distante";

const DIAS_CRITICO = 3;
const DIAS_ATENCAO = 10;

/** Prazo sem hora vence no fim do dia — é como o SIGAA e os professores tratam. */
export const MINUTO_FIM_DO_DIA = 23 * 60 + 59;

/**
 * Dias de CALENDÁRIO entre hoje e a data, não janelas de 24h: às 16h de
 * segunda, uma entrega na quinta são "3 dias" para qualquer aluno, ainda que
 * faltem 56 horas.
 */
export function diasAte(dataIso: string, agora: Date): number {
  const alvo = parseIsoDate(dataIso);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round((alvo.getTime() - hoje.getTime()) / umDia);
}

export function classificarUrgencia(diasRestantes: number): Urgencia {
  if (diasRestantes <= DIAS_CRITICO) {
    return "critico";
  }
  return diasRestantes <= DIAS_ATENCAO ? "atencao" : "distante";
}

export type ItemDoDia =
  | { kind: "aula"; inicioMin: number; aula: ScheduleBlock }
  | { kind: "ponto"; inicioMin: number; ponto: PontoAtencao };

function minutoDoPonto(ponto: PontoAtencao): number {
  if (!ponto.hora) {
    return MINUTO_FIM_DO_DIA;
  }
  const [h, m] = ponto.hora.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Mistura os prazos de uma data com as aulas daquele dia, em ordem
 * cronológica. Item contestado não entra: por definição do estado, ele só
 * existe na lista completa.
 */
export function intercalarDia(
  aulas: ScheduleBlock[],
  pontos: PontoAtencao[],
): ItemDoDia[] {
  const itens: ItemDoDia[] = [
    ...aulas.map((aula): ItemDoDia => ({ kind: "aula", inicioMin: aula.inicioMin, aula })),
    ...pontos
      .filter((ponto) => ponto.estado !== "CONTESTADO")
      .map((ponto): ItemDoDia => ({
        kind: "ponto",
        inicioMin: minutoDoPonto(ponto),
        ponto,
      })),
  ];

  return itens.sort((a, b) => a.inicioMin - b.inicioMin);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npm test -- pontos-atencao`
Expected: PASS (9 testes). Se `parseIsoDate` não estiver exportado de `lib/periodo-letivo`, exportá-lo.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib
git commit -m "feat(mobile): urgência e intercalação de prazos com aulas"
```

---

### Task 11: Seção de pontos de atenção na home

**Files:**
- Create: `mobile/src/components/PontosAtencaoSection.tsx`
- Modify: `mobile/src/screens/HomeTab.tsx`
- Test: `mobile/src/__tests__/pontos-atencao-home.test.tsx`

**Interfaces:**
- Consumes: `getPontosAtencao` (Task 9), `classificarUrgencia`/`diasAte`/`intercalarDia` (Task 10).
- Produces: `<PontosAtencaoSection pontos={...} agora={...} />`; testIDs `pontos-atencao-hero`, `pontos-atencao-vazio`, `ponto-do-dia-${id}`.

**Referência visual:** `.design/home/Main.dc.html` (artboard "D · Síntese"). Cores por token: `critico` → `danger-soft` com borda `danger/30`, `atencao` → `warning-soft-foreground` na data, `distante` → sem tinta. Raios 24px no grupo conectado, 16px nos cards de lista, gap 2px entre herói e lista.

- [ ] **Step 1: Write the failing test**

`mobile/src/__tests__/pontos-atencao-home.test.tsx`, seguindo o setup dos testes de `home.test.tsx` (mock de `@/lib/api`, `renderRouter`/`render` async — ver a nota sobre RTL v14 e fake timers):

```typescript
it("mostra o prazo mais próximo no card herói", async () => {
  const { getByTestId } = await renderHome({
    pontos: [pontoFalso({ id: "p1", data: "2026-08-27", titulo: "Relatório final" })],
  });

  const hero = getByTestId("pontos-atencao-hero");
  expect(hero).toHaveTextContent("3");
  expect(hero).toHaveTextContent("Relatório final");
});

it("mostra a linha de vazio quando não há nenhum prazo", async () => {
  const { getByTestId, queryByTestId } = await renderHome({ pontos: [] });

  expect(getByTestId("pontos-atencao-vazio")).toBeTruthy();
  expect(queryByTestId("pontos-atencao-hero")).toBeNull();
});

it("mantém o item contestado fora do herói e do bloco do dia", async () => {
  const { queryByTestId } = await renderHome({
    pontos: [pontoFalso({ id: "p1", estado: "CONTESTADO" })],
  });

  expect(queryByTestId("pontos-atencao-hero")).toBeNull();
  expect(queryByTestId("ponto-do-dia-p1")).toBeNull();
});

it("intercala o prazo do dia selecionado entre as aulas", async () => {
  const { getByTestId } = await renderHome({
    diaSelecionado: 3, // quinta
    pontos: [pontoFalso({ id: "p1", data: "2026-08-27" })],
  });

  expect(getByTestId("ponto-do-dia-p1")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- pontos-atencao-home`
Expected: FAIL — nada renderiza esses testIDs.

- [ ] **Step 3: Write the section component**

`mobile/src/components/PontosAtencaoSection.tsx`: um componente de apresentação puro (recebe `pontos`, `agora`, `onNovo`, `onVerTudo`; não busca nada).

Estrutura, seguindo o artboard D:

- cabeçalho: `Typography.Heading type="h4"` com "Pontos de atenção", chip `bg-danger-soft` com a contagem, e à direita "Ver tudo" + `AppIcon name="IconCaretRight"`;
- se `pontos.length === 0`: uma `Pressable` com `testID="pontos-atencao-vazio"`, texto "Nenhuma prova ou trabalho cadastrado" e um "+", chamando `onNovo`;
- senão, grupo conectado `gap-0.5`:
  - herói (`testID="pontos-atencao-hero"`), `rounded-t-3xl rounded-b-md`, fundo `bg-danger-soft` com `border-danger/30` quando a urgência é `critico` (senão `bg-surface-secondary`): número de dias em `font-mono text-[52px]`, "dias", chip de tipo com ícone, `Typography.Heading type="h6"` com o título, e a linha `código · dia dd/mm`;
  - lista "Depois disso", `rounded-t-md rounded-b-3xl bg-surface-secondary`, uma linha por ponto restante: coluna de data (`dd` em mono + mês abreviado), barra de 3px na cor da matéria, título + `código · tipo`, e `Nd` à direita.

Filtrar `estado !== "CONTESTADO"` na entrada do componente — o contestado não existe em nenhuma das duas superfícies.

- [ ] **Step 4: Wire it into HomeTab**

Em `mobile/src/screens/HomeTab.tsx`:

1. carregar os pontos junto do schedule, com o mesmo padrão de `LoadState` já usado — um `useState<PontoAtencao[]>([])` alimentado por `getPontosAtencao(accessToken, { incluirVencidos: false })` no mesmo `useEffect` que chama `loadSchedule`. Falha na busca de pontos **não** derruba a tela: `catch` que só loga e deixa a lista vazia, porque o horário é a razão principal da tela;
2. renderizar `<PontosAtencaoSection>` como primeiro filho do `ScrollView`, antes do bloco "Sua semana";
3. na lista do dia, trocar `daySchedule.map(...)` por `intercalarDia(daySchedule, pontosDoDia).map(...)`, onde `pontosDoDia` filtra por `ponto.data === days[selectedDay].iso` (se `getCurrentWeekDays()` não expõe a data ISO do dia, derivá-la de `day.date` com `toISOString().slice(0, 10)` ajustado ao fuso local, ou adicionar o campo lá);
4. o item `kind === "ponto"` renderiza um card com `testID={`ponto-do-dia-${ponto.id}`}`, mesma anatomia do card de aula (barra de 4px, coluna de 56px com a hora ou "prazo", título e código), com fundo `bg-danger-soft` e borda `border-danger/30`.

- [ ] **Step 5: Run tests**

Run: `cd mobile && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src
git commit -m "feat(mobile): seção de pontos de atenção e prazos nos blocos do dia"
```

---

### Task 12: Telas de cadastro/edição e lista completa

**Files:**
- Create: `mobile/src/app/ponto-de-atencao/novo.tsx`
- Create: `mobile/src/app/ponto-de-atencao/[id].tsx`
- Create: `mobile/src/app/pontos-atencao.tsx`
- Test: `mobile/src/__tests__/ponto-atencao-form.test.tsx`
- Test: `mobile/src/__tests__/pontos-atencao-lista.test.tsx`

**Interfaces:**
- Consumes: tudo das Tasks 9–11.
- Produces: rotas `/ponto-de-atencao/novo?turmaId=`, `/ponto-de-atencao/[id]`, `/pontos-atencao`.

- [ ] **Step 1: Write the failing form test**

`mobile/src/__tests__/ponto-atencao-form.test.tsx`:

```typescript
it("esconde o seletor quando a turma vem na rota", async () => {
  const { queryByTestId } = await renderNovo({ turmaId: "turma-1" });

  expect(queryByTestId("seletor-turma")).toBeNull();
});

it("mostra o seletor com as turmas do semestre quando não vem turma", async () => {
  const { getByTestId } = await renderNovo({});

  expect(getByTestId("seletor-turma")).toHaveTextContent("ENGG64");
});

it("envia tipo, título e data ao salvar", async () => {
  const { getByTestId } = await renderNovo({ turmaId: "turma-1" });

  fireEvent.press(getByTestId("tipo-PROVA"));
  fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
  fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
  fireEvent.press(getByTestId("salvar-ponto"));

  await waitFor(() => {
    expect(postPontoAtencao).toHaveBeenCalledWith("token", "turma-1", {
      tipo: "PROVA",
      titulo: "Avaliação I",
      data: "2026-09-22",
      hora: undefined,
      observacao: undefined,
    });
  });
});

it("não deixa salvar sem título", async () => {
  const { getByTestId, queryByTestId } = await renderNovo({ turmaId: "turma-1" });

  fireEvent.press(getByTestId("salvar-ponto"));

  expect(postPontoAtencao).not.toHaveBeenCalled();
  expect(queryByTestId("erro-titulo")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- ponto-atencao-form`
Expected: FAIL — rota não existe.

- [ ] **Step 3: Write the form screen**

`mobile/src/app/ponto-de-atencao/novo.tsx`, usando `AppBar` como as outras rotas de detalhe (`documentos.tsx`, `arvore-dependencias.tsx`):

- lê `useLocalSearchParams<{ turmaId?: string }>()`;
- carrega as turmas de `getSchedule` só quando `turmaId` não veio, para montar o `testID="seletor-turma"` (uma linha por turma, rótulo `código · nome`);
- campos: dois botões de tipo (`testID="tipo-PROVA"` / `tipo-TRABALHO`), `Input` de título (`campo-titulo`), `Input` de data mascarada `dd/mm/aaaa` (`campo-data`), `Input` de hora opcional `hh:mm` (`campo-hora`), `Input` de observação (`campo-observacao`);
- converte `dd/mm/aaaa` para `YYYY-MM-DD` antes de enviar;
- validação local: título não vazio (`erro-titulo`), data válida e não anterior a hoje (`erro-data`);
- `Button` "Salvar" (`salvar-ponto`) chamando `postPontoAtencao` e, no sucesso, `router.back()`;
- erro de rede via `describeApiError`, no mesmo padrão das outras telas.

- [ ] **Step 4: Write the edit screen**

`mobile/src/app/ponto-de-atencao/[id].tsx`: reaproveita o mesmo formulário (extrair o corpo de `novo.tsx` para `mobile/src/components/PontoAtencaoForm.tsx` e as duas rotas passam a ser cascas finas). Carrega o item de `getPontosAtencao(accessToken, { incluirVencidos: true })` filtrando por id — não há `GET /pontos-atencao/:id`, e a lista já vem completa. Salva com `patchPontoAtencao`. Mostra "Apagar" apenas quando `podeApagar`.

- [ ] **Step 5: Write the failing list test**

`mobile/src/__tests__/pontos-atencao-lista.test.tsx`:

```typescript
it("mostra o item contestado apagado, com o motivo e o botão de corrigir", async () => {
  const { getByTestId } = await renderLista({
    pontos: [pontoFalso({ id: "p1", estado: "CONTESTADO", contestacoes: 3 })],
  });

  const item = getByTestId("ponto-p1");
  expect(item).toHaveTextContent("3 colegas contestaram esta data");
  expect(getByTestId("corrigir-p1")).toBeTruthy();
});

it("registra a contestação", async () => {
  const { getByTestId } = await renderLista({ pontos: [pontoFalso({ id: "p1" })] });

  fireEvent.press(getByTestId("contestar-p1"));

  await waitFor(() => {
    expect(putVotoPontoAtencao).toHaveBeenCalledWith("token", "p1", "CONTESTA");
  });
});

it("desfaz o voto ao tocar de novo no mesmo botão", async () => {
  const { getByTestId } = await renderLista({
    pontos: [pontoFalso({ id: "p1", meuVoto: "CONFIRMA" })],
  });

  fireEvent.press(getByTestId("confirmar-p1"));

  await waitFor(() => {
    expect(deleteVotoPontoAtencao).toHaveBeenCalledWith("token", "p1");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mobile && npm test -- pontos-atencao-lista`
Expected: FAIL — rota não existe.

- [ ] **Step 7: Write the list screen**

`mobile/src/app/pontos-atencao.tsx`:

- busca com `getPontosAtencao(accessToken, { incluirVencidos: true })`;
- três grupos, nesta ordem, cada um com seu cabeçalho e omitido quando vazio: **Próximos** (`estado === "NORMAL"` e `diasAte >= 0`), **Contestados**, **Vencidos**;
- cada item (`testID={`ponto-${id}`}`): tipo com ícone, título, `código · dd/mm`, nome do responsável, e dois botões de voto (`confirmar-${id}` / `contestar-${id}`) com a contagem. Tocar no botão do voto que já é o seu chama `deleteVotoPontoAtencao`; tocar no outro chama `putVotoPontoAtencao`;
- item contestado renderiza com `opacity-60`, a linha "N colegas contestaram esta data" e um botão **Corrigir** (`corrigir-${id}`) que navega para `/ponto-de-atencao/${id}`;
- item vencido renderiza com `opacity-60` e sem botões de voto;
- botão "+" no `AppBar` navegando para `/ponto-de-atencao/novo`.

- [ ] **Step 8: Run the full mobile suite**

Run: `cd mobile && npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src
git commit -m "feat(mobile): telas de cadastro, edição e lista de pontos de atenção"
```

---

### Task 13: Atualizar o ROADMAP

**Files:**
- Modify: `ROADMAP.md:138-145`

- [ ] **Step 1: Rewrite item 13**

Trocar a descrição do item 13 para registrar a decisão que a spec tomou: a Turma Virtual foi descartada como origem de prazos na v1 porque o preenchimento varia de professor para professor; o cadastro é feito pelos próprios alunos; turma virou entidade global com tabela de junção. Marcar como ✅ feito e apontar para `docs/superpowers/specs/2026-08-23-pontos-de-atencao-design.md`.

Ajustar também o item 1 (página por matéria), cuja premissa muda: ele agora herda a entidade `Turma` já pronta, e não precisa mais amortizar o scraping da Turma Virtual junto com o item 13.

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: item 13 do roadmap entregue sem depender da turma virtual"
```
