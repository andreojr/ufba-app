# Moodle (AVA UFBA) integration — design spec

## Motivation

Muitos professores da UFBA entregam material, avisos e tarefas pelo
Moodle em `https://ava.ufba.br`. Hoje o Gradline não alcança nada
disso: o item "Vincular Moodle" em Ajustes existe apenas como
placeholder desabilitado com chip "Em breve"
(`mobile/src/app/(tabs)/ajustes.tsx`, `testID="link-moodle-item"`).

O objetivo é que o estudante conecte a conta do AVA **uma única vez** e,
a partir daí, o app leia turmas virtuais, materiais/arquivos, avisos e
tarefas — somente leitura, sem qualquer escrita no sistema.

## Feasibility (sondagem de 2026-08-23)

Sondas de leitura pública contra `ava.ufba.br`:

- `GET /login/index.php` → 302 `/auth/shibboleth/index.php` → 302
  `https://cafe.ufba.br/idp/profile/SAML2/Redirect/SSO?SAMLRequest=...`.
  Ou seja, autenticação é **Shibboleth SAML2** federada (CAFe/RNP), IdP
  em `cafe.ufba.br`. (O usuário referiu-se a `care.ufba.br`; o host
  efetivamente observado no redirect foi `cafe.ufba.br` — a confirmar em
  campo, mas não altera o design.)
- `GET /admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=1&urlscheme=moodlemobile`
  → também entra no fluxo Shibboleth → `cafe.ufba.br`. **Isso é
  decisivo:** o fluxo de token do app oficial do Moodle está presente e
  encadeado ao SSO, então dá para usar o mecanismo oficial em vez de
  raspar HTML.
- `tool_mobile_get_public_config` via REST GET retornou `invalidtoken`.
  Não bloqueia o design (o launch encadear SSO já é o sinal que
  importa), mas confirma que a lista real de funções WS expostas só é
  conhecível após o primeiro login (ver Riscos).

Conclusão: viável pelo **fluxo de token do Moodle Mobile** (WebView/SSO
→ custom scheme → web service token → REST JSON).

## Scope

Em escopo (v1):
- Fluxo de vínculo que captura o token WS do Moodle via SSO, disparado
  a partir do item já existente em Ajustes.
- Armazenamento do token **apenas no device** (`expo-secure-store`).
- Cliente REST client-direto para `ava.ufba.br/webservice`.
- Telas de leitura:
  - **Turmas virtuais** matriculadas.
  - **Materiais/arquivos** (seções → recursos → abrir/baixar arquivo).
  - **Avisos** (fórum de notícias).
  - **Tarefas/prazos** (assignments + deadlines).

Fora de escopo (deferido explicitamente):
- Qualquer participação no backend: o token nunca sai do aparelho; não
  há endpoint novo no NestJS, nem cofre/persistência em nuvem para o
  Moodle (diferente do SIGAA).
- Escrita de qualquer tipo (postar em fórum, enviar tarefa, marcar como
  concluído).
- Sincronização em background / push a partir do token.
- Google Classroom (`link-classroom-item` continua "Em breve").

## Architecture

Subsistema **mobile puro**, espelhando o padrão já usado pelo SIGAA no
app (`sigaa-storage.ts` + `sigaa-link-context.tsx`), mas sem contraparte
de backend. Um `MoodleLinkProvider` mantém o estado do vínculo; o item
de Ajustes é o ponto de entrada; rotas novas exibem o conteúdo.

Diferença central de confiança vs. SIGAA: **a senha institucional nunca
passa pelo app nem pelo backend** — é digitada exclusivamente no IdP
`cafe.ufba.br` dentro da sessão de autenticação do sistema. O único
segredo que o app guarda é um **token de web service de leitura**.

## Auth flow (captura de token)

1. O app abre `WebBrowser.openAuthSessionAsync(launchUrl, returnScheme)`
   (`expo-web-browser` — ASWebAuthenticationSession no iOS / Chrome
   Custom Tabs no Android; mais robusto com SSO que WebView embutido),
   com:
   ```
   launchUrl = https://ava.ufba.br/admin/tool/mobile/launch.php
     ?service=moodle_mobile_app
     &passport=<número aleatório gerado e guardado em memória>
     &urlscheme=ufba-app
   ```
2. Moodle → Shibboleth → `cafe.ufba.br`. Usuário autentica **uma vez**.
3. Moodle redireciona para `ufba-app://token=<base64>`. A sessão de auth
   retorna essa URL ao app.
4. O app decodifica: `atob(base64)` → `"<passport>:::<wstoken>[:::<privatetoken>]"`.
   - **Valida** que `<passport>` bate com o gerado no passo 1 (mitiga
     token injetado/forjado). Divergência → aborta com erro.
   - Extrai `wstoken` (e `privatetoken`, se presente).
5. `core_webservice_get_site_info` com o `wstoken` → obtém `userid`,
   `siteurl` e a lista `functions[]` disponível. Persiste
   `{ wstoken, privatetoken?, siteUrl, userId }`.

### Risco de `forcedurlscheme` (verificar na implementação)

Alguns Moodles definem `tool_mobile | forcedurlscheme = moodlemobile` e
ignoram o `urlscheme` que passamos, redirecionando para
`moodlemobile://token=...`. A **primeira tarefa da implementação** é
rodar o fluxo real e observar o scheme de retorno:
- Se retornar `ufba-app://` → nada a fazer (scheme já registrado no
  `app.json`).
- Se retornar `moodlemobile://` → registrar também o scheme
  `moodlemobile` no `app.json` e rodar `expo prebuild` (ver gotcha de
  prebuild do projeto: `android/` é artefato gitignored e precisa ser
  regenerado ao adicionar scheme nativo).

## Components (todos novos, mobile)

- `mobile/src/lib/moodle-storage.ts` — espelha `sigaa-storage.ts`.
  `getMoodleSession()` / `saveMoodleSession(session)` /
  `clearMoodleSession()` / `hasEverLinkedMoodle()` /
  `rememberMoodleWasLinked()`, sob a chave `"gradline.moodle"` em
  `expo-secure-store`. Tipo persistido:
  `{ wstoken: string; privatetoken?: string; siteUrl: string; userId: number }`.
  Guard de validação (`isMoodleSession`) como em `sigaa-storage.ts`;
  JSON corrompido → `null`.

- `mobile/src/lib/moodle-api.ts` — cliente REST client-direto.
  - Helper base `callMoodle<T>(session, wsfunction, params)`:
    `POST ${session.siteUrl}/webservice/rest/server.php` com corpo
    `wstoken`, `wsfunction`, `moodlewsrestformat=json`, `...params`.
    Segue as convenções de `api.ts` (`ApiError`, timeout ~10s).
    Se a resposta for `{ exception, errorcode }`:
      - `errorcode === "invalidtoken"` → dispara verdict "expired"
        (ver contexto) e lança `ApiError` com `code: "MOODLE_INVALID_TOKEN"`.
      - outros → `ApiError` com a mensagem do Moodle.
  - `getSiteInfo(session)` → `core_webservice_get_site_info`
    (`userid`, `functions[]`).
  - `getCourses(session)` → `core_enrol_get_users_courses`
    (`userid: session.userId`).
  - `getCourseContents(session, courseId)` → `core_course_get_contents`.
  - `getNewsForums(session, courseIds)` →
    `mod_forum_get_forums_by_courses` (+ `mod_forum_get_forum_discussions`
    para o fórum `type === "news"`).
  - `getAssignments(session, courseIds)` → `mod_assign_get_assignments`;
    deadlines via `core_calendar_get_action_events_by_courses`.
  - `fileUrl(session, pluginfileUrl)` → anexa `?token=<wstoken>`
    (ou `&token=` se já houver query) para download autenticado de
    `pluginfile`.

- `mobile/src/lib/moodle-link-context.tsx` — `MoodleLinkProvider` /
  `useMoodleLink()`, espelhando `sigaa-link-context.tsx`.
  - Estado: `{ status: "loading" | "unlinked" | "linked" }`.
  - On mount: lê `getMoodleSession()`; presente → `linked`; ausente →
    `unlinked`. (Sem fallback de nuvem — token só existe no device.)
  - `link()` — executa o Auth flow acima; em sucesso salva a sessão,
    marca `rememberMoodleWasLinked()`, seta `linked`.
  - `unlink()` — `clearMoodleSession()`, seta `unlinked`.
  - Listener central `onMoodleTokenVerdict` (espelho de
    `onSigaaCredentialsVerdict`): quando alguma chamada REST reporta
    `MOODLE_INVALID_TOKEN`, marca o vínculo como expirado para a UI
    oferecer reconexão.

- `mobile/src/app/(tabs)/ajustes.tsx` (edição) — habilitar
  `link-moodle-item`: remover `disabled`, `className="opacity-50"` e o
  chip "Em breve". `onPress` chama `useMoodleLink().link()` quando
  `unlinked`; quando `linked`, navega para a lista de turmas (e/ou
  mostra chip "Conectado" + ação de desvincular), espelhando o
  comportamento do item de SIGAA. O item de Classroom permanece
  inalterado.

- Rotas de conteúdo (novas, sob `mobile/src/app/`):
  - `moodle/index.tsx` — lista de turmas virtuais.
  - `moodle/[courseId].tsx` — seções e materiais da turma, com
    avisos e tarefas da turma acessíveis a partir daí (abas ou seções).
  - Abrir/baixar arquivo reutiliza o padrão já existente de documentos
    do app quando aplicável.

## Data flow

```
Ajustes: toca "Vincular Moodle" (status unlinked)
  → useMoodleLink().link()
  → WebBrowser.openAuthSessionAsync(launch.php?...&urlscheme=ufba-app, "ufba-app://")
      Moodle → Shibboleth → cafe.ufba.br (usuário digita a senha UMA vez)
  → retorno: ufba-app://token=<base64>
      decode → "<passport>:::<wstoken>[:::<privatetoken>]"
      passport confere? não → aborta (erro)
      sim → core_webservice_get_site_info → { userid, functions[] }
  → saveMoodleSession({ wstoken, privatetoken?, siteUrl, userId })
  → status: linked

Navegação de conteúdo (status linked)
  → getCourses → lista de turmas
  → getCourseContents(courseId) → seções/materiais → fileUrl p/ abrir arquivo
  → getNewsForums / getAssignments conforme a tela
      qualquer resposta com errorcode "invalidtoken"
        → verdict "expired" → UI oferece reconectar (re-run do fluxo)
```

## Error handling

- **Usuário cancela a sessão de auth** (fecha o browser) →
  `openAuthSessionAsync` retorna `type: "cancel"/"dismiss"`; sem toast
  de erro, apenas permanece `unlinked`.
- **Passport não confere** no retorno → aborta com toast: "Não foi
  possível concluir a conexão com o Moodle. Tente novamente." Nenhum
  token é salvo.
- **`invalidtoken` em chamada REST** → o token expirou/foi revogado;
  verdict "expired", a tela mostra estado de reconexão (não derruba
  outras partes do app), token local é limpo.
- **Erro de rede/timeout** em chamadas de conteúdo → toast padrão do
  app; o vínculo permanece (é falha transitória, não de credencial).
- **Falha ao salvar a sessão localmente** após captura bem-sucedida →
  `console.warn` e trata como não vinculado (usuário reconecta) — sem
  copiar o token para lugar nenhum além do secure storage.

## Security considerations

- A senha institucional **nunca** transita pelo app nem pelo backend do
  Gradline: é digitada apenas no IdP `cafe.ufba.br` dentro de uma
  sessão de autenticação do sistema (ASWebAuthenticationSession /
  Custom Tabs). O app só vê o `wstoken`.
- O `wstoken` é armazenado **exclusivamente** em `expo-secure-store`
  (Keychain/Keystore). Não há transmissão a servidores do Gradline nem
  persistência em nuvem — modelo estritamente mais restrito que o do
  SIGAA.
- Uso é **somente leitura**: apenas funções WS de consulta são
  chamadas; nenhuma função de escrita entra no cliente.
- Validação de `passport` no retorno protege contra um token injetado
  por um redirect malicioso para o custom scheme.
- `unlink()` remove o token do device. (Revogação server-side depende do
  Moodle/admin; fora do controle do app.)

## Testing

Arquivos `*.test.ts(x)` co-locados, seguindo a convenção do projeto
(RTL v14; timers assíncronos conforme a prática do projeto):

- `moodle-storage.test.ts` — get/save/clear; JSON corrompido → `null`;
  `hasEverLinkedMoodle`.
- `moodle-api.test.ts` — `callMoodle` monta corpo correto; parse de
  sucesso; `errorcode: "invalidtoken"` → `MOODLE_INVALID_TOKEN` +
  verdict; outras exceptions → `ApiError`; `fileUrl` anexa token com
  `?`/`&` corretamente.
- `moodle-link-context.test.tsx` — hidratação a partir do storage;
  transições `loading → linked/unlinked`; `link()` (mockando
  `expo-web-browser`) com retorno válido, passport inválido, e cancel;
  reação ao verdict "expired".
- `ajustes.test.tsx` (estendido) — item habilitado quando `unlinked`
  (dispara `link`), estado conectado quando `linked`; garante que o chip
  "Em breve" some.
- Telas de conteúdo — render das listas de turmas/materiais a partir de
  respostas REST mockadas; estado de reconexão em `invalidtoken`.

## Implementation-time verifications (spikes embutidos)

1. **Scheme de retorno** do `launch.php` (`ufba-app` vs `moodlemobile`)
   — decide se `expo prebuild` é necessário.
2. **Funções WS expostas** pelo serviço `moodle_mobile_app` via
   `core_webservice_get_site_info.functions[]` — confirma quais das 4
   features da v1 o site realmente permite; a UI esconde o que não
   existir em vez de quebrar.
