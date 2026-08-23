# Moodle (AVA UFBA) — conexão da conta — design spec

## Motivation

Muitos professores da UFBA entregam material, avisos e tarefas pelo
Moodle em `https://ava.ufba.br`. Hoje o Gradline não alcança nada disso:
o item "Vincular Moodle" em Ajustes existe apenas como placeholder
desabilitado com chip "Em breve" (`mobile/src/app/(tabs)/ajustes.tsx`,
`testID="link-moodle-item"`).

Este spec cobre **somente a conexão da conta**: fazer o usuário
autenticar no AVA uma única vez e o app guardar, no próprio aparelho, um
token de web service de leitura. Consumir esse token (listar turmas do
Moodle, materiais, etc.) é assunto de specs posteriores — em especial o
da **página de turma virtual (item C do ROADMAP)**, onde o usuário
poderá vincular cada turma sua a uma turma do Moodle e então ver a lista
de turmas do Moodle. Nada disso é definido aqui.

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

Conclusão: a conexão é viável pelo **fluxo de token do Moodle Mobile**
(WebView/SSO → custom scheme → web service token).

## Scope

Em escopo:
- Fluxo de vínculo que captura o token WS do Moodle via SSO, disparado a
  partir do item já existente em Ajustes.
- Validação da conexão via `core_webservice_get_site_info` (para obter e
  guardar o `userId` junto do token).
- Armazenamento do token **apenas no device** (`expo-secure-store`).
- Desvincular (limpar o token do aparelho).
- Estado de "conexão expirada" quando o token deixa de valer, para a UI
  oferecer reconexão.

Fora de escopo (deferido explicitamente):
- **Qualquer leitura de conteúdo do Moodle** — turmas, materiais,
  arquivos, avisos, tarefas. Não há cliente REST além do
  `get_site_info` necessário para validar a conexão.
- **Qualquer contrato de dados agnóstico** (SIGAA/Moodle/Classroom
  unificados). Isso pertence ao spec da página de turma virtual.
- **Telas novas** de qualquer tipo. A única mudança de UI é habilitar o
  item já existente em Ajustes.
- Qualquer participação no backend: o token nunca sai do aparelho.
- Escrita de qualquer tipo.
- Sincronização em background / push.
- Google Classroom (`link-classroom-item` continua "Em breve").

## Architecture

Subsistema **mobile puro**, espelhando o padrão já usado pelo SIGAA no
app (`sigaa-storage.ts` + `sigaa-link-context.tsx`), mas sem contraparte
de backend. Um `MoodleLinkProvider` mantém o estado do vínculo; o item de
Ajustes é o único ponto de UI.

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
4. O app decodifica: `atob(base64)` → `"<signature>:::<wstoken>[:::<privatetoken>]"`.
   - **Valida** que `<signature> === md5(siteUrl + passport)` (mesmo
     algoritmo do `validateBrowserReturnToken` do app oficial do Moodle;
     mitiga token injetado por redirect malicioso). Divergência → aborta.
   - Extrai `wstoken` (e `privatetoken`, se presente).
5. `core_webservice_get_site_info` com o `wstoken` → obtém `userid`.
   Persiste `{ wstoken, privatetoken?, siteUrl, userId }`.

### Risco de `forcedurlscheme` (verificar na implementação)

Alguns Moodles definem `tool_mobile | forcedurlscheme = moodlemobile` e
ignoram o `urlscheme` que passamos, redirecionando para
`moodlemobile://token=...`. A **primeira verificação de campo** é rodar o
fluxo real e observar o scheme de retorno:
- Se retornar `ufba-app://` → nada a fazer (scheme já registrado no
  `app.json`).
- Se retornar `moodlemobile://` → registrar também o scheme `moodlemobile`
  no `app.json` e rodar `expo prebuild` (regenera `android/`, que é
  artefato gitignored — ver gotcha de prebuild do projeto).

## Components (todos novos, mobile)

- `mobile/src/lib/moodle-storage.ts` — espelha `sigaa-storage.ts`.
  `getMoodleSession()` / `saveMoodleSession(session)` /
  `clearMoodleSession()` / `hasEverLinkedMoodle()` /
  `rememberMoodleWasLinked()`, sob a chave `"gradline.moodle"` em
  `expo-secure-store`. Tipo:
  `{ wstoken: string; privatetoken?: string; siteUrl: string; userId: number }`.

- `mobile/src/lib/moodle-auth.ts` — captura do token.
  - Puro: `parseReturnedToken(base64)` (split por `":::"`),
    `verifyPassport(signature, siteUrl, passport)` (`md5(siteUrl + passport)`
    via `expo-crypto`).
  - `startMoodleLogin(resolveUserId)` — dispara
    `WebBrowser.openAuthSessionAsync`, compõe o parse/verify e resolve o
    `userId`; retorna `success | cancelled | failed`.

- `mobile/src/lib/moodle-api.ts` — **mínimo** para validar a conexão.
  - `callMoodle<T>(session, wsfunction, params?)` — `POST` para
    `${siteUrl}/webservice/rest/server.php` com `wstoken` +
    `moodlewsrestformat=json`. Resposta com `errorcode: "invalidtoken"` →
    dispara verdict "expired" e lança `ApiError` com
    `code: "MOODLE_INVALID_TOKEN"`; outras exceptions → `ApiError`.
  - `getSiteInfo(session)` → `core_webservice_get_site_info` (retorna
    `userId`).
  - `onMoodleTokenVerdict(listener)` — espelho de
    `onSigaaCredentialsVerdict`, para a UI reagir a token expirado.
  - (Nenhuma função de conteúdo — turmas/materiais/etc. ficam para specs
    posteriores.)

- `mobile/src/lib/moodle-link-context.tsx` — `MoodleLinkProvider` /
  `useMoodleLink()`. Estado
  `{ status: "loading" | "unlinked" | "linked", expired }`. On mount lê
  `getMoodleSession()`. `link()` roda o Auth flow e salva; `unlink()`
  limpa. Listener de `onMoodleTokenVerdict` marca `expired`.

- `mobile/src/app/(tabs)/ajustes.tsx` (edição) — habilitar
  `link-moodle-item`: remover `disabled`/`opacity-50`/chip "Em breve".
  `unlinked` → `onPress` chama `link()`; `linked` → mostra chip
  "Conectado" e `onPress` oferece desvincular (diálogo de confirmação, no
  padrão da tela). **Sem navegação para tela nenhuma.** O item de
  Classroom permanece inalterado.

- `mobile/src/app/_layout.tsx` (edição) — montar `MoodleLinkProvider` na
  árvore (não depende de auth; pode ficar ao lado de `SigaaLinkProvider`).

## Data flow

```
Ajustes: toca "Vincular Moodle" (status unlinked)
  → useMoodleLink().link()
  → WebBrowser.openAuthSessionAsync(launch.php?...&urlscheme=ufba-app, "ufba-app://token")
      Moodle → Shibboleth → cafe.ufba.br (usuário digita a senha UMA vez)
  → retorno: ufba-app://token=<base64>
      decode → "<signature>:::<wstoken>[:::<privatetoken>]"
      signature confere (md5(siteUrl+passport))? não → aborta (failed)
      sim → core_webservice_get_site_info → { userid }
  → saveMoodleSession({ wstoken, privatetoken?, siteUrl, userId })
  → status: linked

Ajustes: toca item já conectado (status linked)
  → diálogo "Desvincular Moodle?" → unlink() → clearMoodleSession() → unlinked

Token expira (detectado por futura leitura que use callMoodle)
  → verdict "expired" → item de Ajustes indica reconexão necessária
```

## Error handling

- **Usuário cancela a sessão de auth** → `openAuthSessionAsync` retorna
  `type: "cancel"/"dismiss"`; sem toast, permanece `unlinked`.
- **Signature não confere / sem token no retorno** → aborta com toast:
  "Não foi possível conectar ao Moodle. Tente novamente." Nenhum token é
  salvo.
- **`invalidtoken`** em qualquer `callMoodle` → verdict "expired"; token
  local é tratado como inválido, UI oferece reconectar.
- **Falha ao salvar a sessão localmente** após captura → `console.warn`
  e trata como não vinculado (usuário reconecta).

## Security considerations

- A senha institucional **nunca** transita pelo app nem pelo backend do
  Gradline: é digitada apenas no IdP `cafe.ufba.br` dentro de uma sessão
  de autenticação do sistema (ASWebAuthenticationSession / Custom Tabs).
- O `wstoken` é armazenado **exclusivamente** em `expo-secure-store`
  (Keychain/Keystore). Sem transmissão a servidores do Gradline, sem
  persistência em nuvem.
- Validação de `signature` no retorno protege contra token injetado por
  um redirect malicioso para o custom scheme.
- `unlink()` remove o token do device.

## Testing

Arquivos `*.test.ts(x)` co-locados, seguindo a convenção do projeto
(RTL v14; timers assíncronos conforme a prática do projeto):

- `moodle-storage.test.ts` — get/save/clear; JSON corrompido → `null`;
  `hasEverLinkedMoodle`.
- `moodle-auth.test.ts` — `parseReturnedToken` (com/sem private token,
  formato inválido); `verifyPassport` (match/no-match); `startMoodleLogin`
  (cancel, sucesso, signature inválida).
- `moodle-api.test.ts` — `callMoodle` monta corpo correto; `invalidtoken`
  → `MOODLE_INVALID_TOKEN` + verdict; outras exceptions → `ApiError`;
  `getSiteInfo` mapeia `userId`.
- `moodle-link-context.test.tsx` — hidratação; transições
  `loading → linked/unlinked`; `link()` (mockando `expo-web-browser`) com
  sucesso, signature inválida e cancel; reação ao verdict "expired".
- `ajustes.test.tsx` (estendido) — item habilitado quando `unlinked`
  (dispara `link`), estado "Conectado" quando `linked` e desvínculo ao
  tocar; garante que o chip "Em breve" do item do Moodle some.

## Implementation-time verifications (spikes de campo)

1. **Scheme de retorno** do `launch.php` (`ufba-app` vs `moodlemobile`) —
   decide se `expo prebuild` é necessário.
2. **`get_site_info` responde com o token capturado** — confirma que o
   serviço `moodle_mobile_app` está de fato utilizável para o usuário.
