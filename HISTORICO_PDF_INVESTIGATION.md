# Investigação: gerar o PDF do Histórico Escolar via API (sem browser)

## Status: RESOLVIDO no código — aguardando validação contra o SIGAA real

O backend agora baixa o histórico pelo **fluxo clássico** do portal discente
(o mesmo que funcionou no browser desktop), não mais pelo endpoint mobile
touch que retornava vazio pra conta real. Implementado com testes (111
passando). Falta validar contra o SIGAA da UFBA com uma conta real (via app
ou via curl com um JSESSIONID de sessão logada).

## Por que o fluxo mobile touch falhava

O endpoint `/sigaa/mobile/touch/gerarHistorico?sistema=2` retornava
`Content-Length: 0` pra conta real (login CPF) mesmo com login, menu e
redirect todos corretos — e falhava até num WebView de verdade com a mesma
conta (baixava o HTML da página em vez do PDF). Ou seja: o problema não era o
login programático, era o próprio fluxo mobile touch, que só funciona pra
alguns vínculos (funcionou pra conta matrícula 223116037, não pra conta CPF).
A mesma conta CPF baixava o PDF normalmente pelo **menu clássico** no browser
desktop.

## O fluxo clássico (descoberto e implementado)

Confirmado por três fontes independentes (sig-sdk, app Android da UFC, dump
HTML real de um portal discente):

1. `GET /sigaa/portais/discente/discente.jsf` — a home clássica (mesma página
   que o `fetchSchedule` já usa). Dela se extraem dois valores que **variam
   por deploy do SIGAA** (não hardcodar!):
   - o hidden `<input name="id" value="...">` do form `menu:form_menu_discente`;
   - o token `jscook_action` do item "Emitir Histórico" no array JS do
     JSCookMenu, ex.:
     `menu_form_menu_discente_discente_menu:A]#{ portalDiscente.historico }`
     (na UFC o prefixo é `menu_form_menu_discente_j_id_jsp_440181972_4_menu`).
2. `POST /sigaa/portais/discente/discente.jsf` com:
   - `menu:form_menu_discente=menu:form_menu_discente`
   - `id=<extraído>`
   - `jscook_action=<extraído>`
   - `javax.faces.ViewState=<atual>`
3. A resposta é **o PDF direto no corpo do 200** (sem redirect, ao contrário
   do fluxo mobile touch que fazia 302 → gerarHistorico).

## O que foi implementado

- [`parsers/portal-menu.ts`](backend/src/sigaa-engine/parsers/portal-menu.ts) —
  `parseHistoricoMenuPostback(html)`: extrai `id` + `jscookAction` da home do
  portal, com erros descritivos quando não encontra. Fixture realista em
  `parsers/__fixtures__/portal-discente-menu.html` (espelha o markup real,
  inclusive o item "Histórico Completo" que o regex não pode confundir).
- [`session.ts`](backend/src/sigaa-engine/session.ts) — `postbackBinary`
  generalizado: aceita tanto resposta binária direta no 200 (fluxo clássico)
  quanto 302 → GET binário (fluxo mobile touch, mantido por generalidade).
- [`sigaa-engine.service.ts`](backend/src/sigaa-engine/sigaa-engine.service.ts) —
  `fetchHistorico` reescrito pro fluxo clássico + validação do magic `%PDF`:
  se vier HTML/vazio, lança erro descritivo (com os primeiros bytes) em vez de
  entregar lixo como se fosse o documento.
- Logs de debug da sessão anterior removidos (controller, session,
  http-client). O `console.warn` no catch de `documentos.tsx` ficou (padrão
  legítimo do app).

## Validação pendente

1. **curl com sessão real** (basta um JSESSIONID de sessão logada no browser):
   GET na home do portal, extrair os dois campos, fazer o POST e conferir que
   volta `%PDF`. Confirma o fluxo na instância da UFBA.
2. **Teste fim-a-fim pelo app** com a conta real (login CPF) — o mesmo caso
   que falhava antes.

## Atestado de Matrícula (investigado — ver doc dedicado)

Confirmado contra o SIGAA real: o postback do atestado devolve uma página
**HTML** de impressão (`window.print()`, CSS `ufrn_print.css`), não um PDF —
não existe endpoint tipo `gerarHistorico` pra ele nessa instância. Escolhida a
**rota B** (backend embute os assets com o cookie e devolve HTML
autossuficiente; o device renderiza pra PDF via `expo-print`).

Detalhes completos — fluxo, token por deploy, código de verificação, tabela de
assets e desenho da implementação — em
[`ATESTADO_MATRICULA_INVESTIGATION.md`](ATESTADO_MATRICULA_INVESTIGATION.md).
