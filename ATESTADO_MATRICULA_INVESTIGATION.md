# Investigação: gerar o Atestado de Matrícula via API (sem browser)

## Status: descoberto, validado contra o SIGAA real e **rota B implementada** (backend + mobile, com testes)

O inliner foi rodado sobre o HTML real do atestado buscando os assets reais com
um `JSESSIONID` logado: 8/8 assets embutidos (5 CSS como `<style>`, 3 imagens
como data URI), 0 `<script>` e 0 `<link>` externos remanescentes, código de
verificação preservado. Falta só o teste fim-a-fim no aparelho (expo-print exige
rebuild do dev client/EAS — ver mobile abaixo).

Diferente do histórico, o SIGAA **não** entrega o atestado como PDF pronto. O
item de menu "Emitir Atestado de Matrícula" devolve uma **página HTML de
impressão** já renderizada (`window.print()` no load, CSS `ufrn_print.css`).
Não existe endpoint tipo `gerarHistorico` pra ele nessa instância. A geração do
PDF, portanto, é responsabilidade nossa — decidimos pela **rota B** (ver
abaixo).

## O fluxo (idêntico ao histórico até o postback)

Mesmo caminho clássico do JSCookMenu que o `fetchHistorico` usa:

1. `login()` → `GET /sigaa/portais/discente/discente.jsf` (home clássica).
2. Da home, extrair (variam por deploy — **não hardcodar**):
   - o hidden `<input name="id" value="...">` do form `menu:form_menu_discente`;
   - o token `jscook_action` do item "Emitir Atestado de Matrícula", cuja
     expressão JSF é `#{ portalDiscente.atestadoMatricula }`.
3. `POST /sigaa/portais/discente/discente.jsf` com:
   - `menu:form_menu_discente=menu:form_menu_discente`
   - `id=<extraído>`
   - `jscook_action=<extraído>`
   - `javax.faces.ViewState=<atual>`
4. A resposta é **um HTML de impressão no corpo do 200** (sem redirect), não um
   PDF.

### ⚠️ O prefixo do token varia por deploy (confirmado)

O fixture `portal-discente-menu.html` (baseado noutro deploy) tem o token com
prefixo `menu_form_menu_discente_discente_menu:A]#{...}`. Na **UFBA** o prefixo
real observado foi:

```
menu_form_menu_discente_j_id_jsp_315194548_99_menu:A]#{ portalDiscente.atestadoMatricula }
```

O `j_id_jsp_315194548_99` é gerado pelo JSF e muda entre deploys. Por isso o
parser deve ancorar na expressão `portalDiscente.atestadoMatricula` e capturar o
token inteiro, **nunca** montar o prefixo à mão. (Mesma lição do histórico.)

## O que a resposta HTML contém (amostra real, conta 223116037)

Página autossuficiente com tabelas bem estruturadas:

- `<table id="identificacao">` — nível (GRADUAÇÃO), matrícula, vínculo (REGULAR),
  nome, curso.
- `<table id="matriculas">` — cabeçalho "COMPROVANTE DE INSCRIÇÃO SEMESTRAL EM
  COMPONENTES CURRICULARES", período letivo (2026.2 com datas), e as turmas
  matriculadas (cód., componente, docente, turma, status, horário).
- `<table id="horario">` — grade de horários (`<h4>Tabela de Horários:</h4>`).
- Rodapé com **código de verificação**.

### Documento oficial e verificável (importante)

O rodapé traz:

> Para verificar a autenticidade deste documento acesse
> `https://sigaa.ufba.br/sigaa/documentos/` informando a matrícula, a data de
> emissão e o código de verificação `<código>`.

Cada emissão gera um **código novo**, registrado no servidor. Ou seja: a
validade jurídica vem do código de verificação, **não** do layout — qualquer PDF
que preserve `matrícula + data de emissão + código` é verificável por terceiros
em `/sigaa/documentos/`. Isso é o que justifica a rota B (fiel ao original) em
vez de re-diagramar o documento do zero.

## Assets referenciados pela página (resolução testada com cookie de sessão)

Para o PDF sair fiel, os assets precisam ser embutidos (a página crua depende de
recursos servidos pelo SIGAA). Resultado de `curl` com `JSESSIONID` logado:

| Asset | Status | Tipo | Como é referenciado |
|---|---|---|---|
| `/shared/css/ufrn.css` | 200 | text/css (37 KB) | `<link>` estático |
| `/sigaa/css/atestado_matricula.css` | 200 | text/css (1.4 KB) | `<link>` estático (CSS específico do doc) |
| `/sigaa/cssBundles/N91553634/bundles/css/sigaa.css` | 200 | text/css (8 KB) | `<link>` estático (path tem versão `N...`) |
| `/sigaa/a4j/s/.../basic_classes.xcss/.../.jsf` | 200 | text/css (6.8 KB) | `<link>` estático (richfaces) |
| `/sigaa/a4j/s/.../extended_classes.xcss/.../.jsf` | 200 | text/css (4.2 KB) | `<link>` estático (richfaces) |
| `/shared/img/instituicao/ufrn.gif` | 200 | image/gif (2.5 KB) | `<img>` no corpo (brasão) |
| `/shared/img/instituicao/sinfo.gif` | 200 | image/gif (2.6 KB) | `<img>` no corpo |
| `/bundles/css/sigaa_base.css` | 200¹ | text/css (gzip) | via `JAWR.loader.style(...)` no JS |
| `/css/ufrn_relatorio.css` | 200¹ | text/css (gzip) | via `JAWR.loader.style(..., 'all')` no JS |
| `/css/ufrn_print.css` | 200¹ | text/css (gzip) | via `JAWR.loader.style(..., 'print')` no JS |

¹ **Não** nesses paths literais (dão 404), e sim no bundle real resolvido pelo
JAWR loader — ver resolução abaixo.

### JAWR: CSS carregado por JS (resolvido)

Três stylesheets não vêm como `<link>` estático; a página os puxa em runtime:

```js
JAWR.loader.style('/bundles/css/sigaa_base.css','all');
JAWR.loader.style('/css/ufrn_relatorio.css','all');
JAWR.loader.style('/css/ufrn_print.css', 'print');
```

Como a rota B remove todos os `<script>`, essas chamadas nunca rodam — e é aí
que os botões **"Voltar"/"Imprimir"** vazavam pro PDF e o cabeçalho perdia o
layout. O `ufrn_print.css` (só 158 B, gzipado) é literalmente
`.naoImprimir, .voltar{display:none;}#container{width:650px;margin:0 auto;}` — o
que esconde a nav e centra o documento na impressão.

**Resolução** ([`jawr-styles.ts`](backend/src/sigaa-engine/jawr-styles.ts)): o
`jawr_loader.js` (em `/shared/jsBundles/jawr_loader.js`) traz um array de
entradas `r("<nome-do-bundle>","/gzip_<hash>/", [...])`. O nome lógico passado
pro `loader.style()` **é** o nome do bundle; a URL real é
`/shared/cssBundles` + prefixo + nome (colapsando `//`), ex.:
`/shared/cssBundles/gzip_48504048/css/ufrn_print.css`. O hash `gzip_...` muda por
deploy, então é resolvido a partir do loader, nunca hardcodado. As `<link>`
resultantes são injetadas antes do inlining. O `media` do loader (ex.: `'print'`)
é **descartado de propósito**: o documento só vira PDF, e não dá pra confiar que
o `expo-print` do aparelho respeite `media="print"` — então as regras de
impressão são aplicadas incondicionalmente (validado renderizando em modo tela,
não só impressão). Os bundles vêm com `Content-Encoding: gzip` e o `fetch` do
Node os descomprime automaticamente.

### Tabela de Horários: preenchida por script (resolvido)

A grade de horários vem no HTML com **toda célula vazia** —
`<span id="<dia>_<slot>">---</span>` — e um `<script>` no fim da página
preenche as ocupadas, uma atribuição por célula:

```js
var elem = document.getElementById('2_15');
if (elem) elem.innerHTML = 'ENGG54';
```

Como removemos os scripts, a grade sairia toda "---". A resolução
([`atestado-grid.ts`](backend/src/sigaa-engine/atestado-grid.ts)) **aplica essas
atribuições no servidor** antes de remover os scripts: casa cada
`getElementById('id'); if (elem) elem.innerHTML = 'code'` com o
`<span id="id">` e troca o "---" pelo código. Não é preciso reimplementar a
lógica de horário — a própria lista de atribuições é o mapa. Validado contra o
atestado real: 22 células preenchidas (ENGG64, ENGG67, MATA58, ENGG54, MATA59,
ENGG56), 20 vazias — batendo com a grade do SIGAA.

### Tamanho de página: A4 (forçado)

O `expo-print` no aparelho gera em **US Letter** por padrão; o SIGAA (e o Brasil)
usa **A4**, o que muda as proporções do documento inteiro. `@page` é a única
alavanca de tamanho de página disponível pelo HTML e todo renderizador a
respeita, então o backend injeta `<style>@page{size:A4;margin:10mm}</style>` no
`<head>`. Com isso o render fica 1240×1754 px a 150 DPI — batendo com o A4 do
SIGAA (1242×1755) — e a página inteira fica visualmente idêntica ao atestado
oficial (cabeçalho, tabelas, bordas, rodapé e código de verificação).

**Validado:** renderizado via headless Chrome em modo impressão (mesmo caminho do
expo-print), o PDF fica visualmente idêntico ao gerado pelo próprio SIGAA —
botões some, cabeçalho horizontal, moldura e código de verificação corretos.

## Rota escolhida: **B — inline no backend + render no device**

Três rotas foram consideradas (ver histórico da investigação): (A) headless
Chromium no backend → PDF, pesado no deploy; (B) backend baixa e embute os
assets com o cookie e devolve HTML autossuficiente, o **device** renderiza pra
PDF; (C) parsear as tabelas e gerar PDF próprio, leve mas perde a cara oficial.

**Rota B** escolhida: backend leve (o resto do motor SIGAA é fetch+parse, sem
browser), saída fiel ao documento oficial, e o app é Expo.

### Desenho da implementação (backend)

- `parsers/portal-menu.ts` — generalizar pra extrair o token de qualquer item do
  menu por expressão JSF; expor `parseAtestadoMenuPostback(html)` além do
  `parseHistoricoMenuPostback`.
- Asset inliner (função pura, testável com fetcher injetado):
  - troca cada `<link rel="stylesheet" href="/sigaa|/shared/...">` por
    `<style>...</style>` com o CSS baixado;
  - troca `<img src="...">` (brasões) por data URI base64;
  - remove `<script>` (não queremos `window.print()`, JAWR loader, cookie
    consent — o device gera o PDF sozinho);
  - assets externos/irresolvíveis: deixa como está (ou remove o link), sem
    derrubar o documento inteiro.
- `http-client.ts` — passar a capturar o header `content-type` (hoje só
  encaminha `location` e `set-cookie`), necessário pro data URI das imagens.
- `session.ts` — método pra baixar um asset com o cookie da sessão
  (`{ contentType, bytes }`).
- `sigaa-engine.service.ts` — `fetchAtestado(credentials)`: login → GET home →
  parse token → `postback` (HTML texto) → inline assets → retorna o HTML
  autossuficiente (string).
- `sigaa.controller.ts` — `POST sigaa/atestado`, devolve `text/html`.

### Desenho da implementação (mobile)

- Adicionar `expo-print` (`npx expo install expo-print`) — **não instalado hoje**
  (só `expo-file-system` e `expo-sharing`). Exige rebuild do dev client/EAS.
- `lib/api.ts` — `postSigaaAtestado(token, creds)` que busca o HTML.
- `documentos.tsx` — trocar `fakeGenerateAtestado` por: buscar HTML →
  `Print.printToFileAsync({ html })` → salvar os bytes do PDF via
  `saveSigaaDocument("atestado", bytes)` (mesmo fluxo de UI do histórico).

## Como reproduzir a investigação (curl)

Basta um `JSESSIONID` de sessão logada no browser (DevTools → Application →
Cookies). O sufixo `.saomiguel` no cookie é o nó Tomcat de roteamento.

```bash
BASE=https://sigaa.ufba.br
COOKIE='JSESSIONID=<valor>.saomiguel'

# 1. home (extrai hidden `id` e ViewState)
curl -s "$BASE/sigaa/portais/discente/discente.jsf" -H "Cookie: $COOKIE" -o home.html

# 2. postback do atestado (corpo cru)
curl -s "$BASE/sigaa/portais/discente/discente.jsf" -H "Cookie: $COOKIE" \
  --data-urlencode 'menu:form_menu_discente=menu:form_menu_discente' \
  --data-urlencode 'id=<id-do-home>' \
  --data-urlencode 'jscook_action=<token-atestadoMatricula-do-home>' \
  --data-urlencode 'javax.faces.ViewState=<viewstate-do-home>' \
  -D headers.txt -o atestado.html

# 3. diagnóstico
head -c 20 atestado.html | xxd      # <!DOCTYPE/<html (não %PDF)
grep -iE 'window.print|ufrn_print|autenticidade|c.digo de verifica' atestado.html
```
