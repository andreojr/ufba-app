# Landing de download

Página estática com os dois caminhos de instalação: o APK direto no Android e,
no iPhone, um formulário pedindo acesso ao TestFlight. Três arquivos, nenhuma
dependência em runtime, nenhum passo de build no deploy.

- `index.html` — a página
- `styles.css` — a folha servida, **compilada e commitada** (ver abaixo)
- `styles.src.css` — a fonte do `styles.css`, só para reproduzir a compilação

## Por que o CSS é commitado

A página usa o design system do app — as classes BEM do
[`@heroui/styles`](https://www.npmjs.com/package/@heroui/styles), as mesmas do
HeroUI Native que o app roda, com o mesmo override de `--accent` (o azul do
brasão da UFBA) que está em `mobile/src/global.css`.

Só que o pacote publicado **não é CSS pronto**: ele tem diretivas `@apply` e
precisa do Tailwind v4 para compilar. Em vez de carregar essa toolchain para
sempre, o CSS é compilado **uma vez** e o resultado entra no repositório.

O que se ganha: o deploy é copiar arquivos, e uma mudança de major do HeroUI
(que está em beta) nunca quebra a publicação de uma versão nova do app.

O que se perde: a página não acompanha automaticamente uma mudança de tema no
app. Se o `--accent` mudar em `mobile/src/global.css`, mude aqui também —
`styles.src.css` tem o mesmo bloco, e é só recompilar.

## Recompilar o `styles.css`

Só é necessário ao mexer em `styles.src.css`, ao adicionar componentes do
HeroUI, ou ao usar uma classe nova no `index.html`.

```bash
npm i -D tailwindcss @tailwindcss/cli @heroui/styles && npx @tailwindcss/cli -i styles.src.css -o styles.css --content index.html --minify
```

Leva menos de meio segundo. Saída atual: 49 KB, ~7 KB com gzip.

Depois pode apagar `node_modules` e `package*.json` — eles não fazem parte do
que é publicado.

## Os dois caminhos por plataforma

Um script síncrono no `<head>` põe `is-ios` ou `is-other` no `<html>`, e o CSS
esconde o bloco que não serve. Três decisões que não são óbvias:

- **É síncrono e fica no `<head>`** de propósito. Marcar a plataforma depois do
  primeiro paint faria o bloco errado piscar na cara do usuário.
- **Sem JS aparecem os dois.** Nenhuma classe é aplicada e o CSS não esconde
  nada. Fica feio, mas ninguém fica sem caminho — é o fallback certo aqui.
- **A detecção testa `maxTouchPoints`** porque iPad moderno se identifica como
  Mac (`MacIntel`) no user agent. Sem isso, iPad cairia no lado do APK.

Há também links de troca manual entre os dois blocos. Existem menos para
corrigir a detecção do que para o caso inverso: alguém no Android querendo o
link do TestFlight para mandar a um amigo com iPhone.

## Por que o iPhone é um pedido, e não um download

A Apple não permite instalar fora da App Store. O acesso é por **TestFlight
interno**, que exige convidar cada testador à mão pelo App Store Connect — daí
o pedido em vez de um botão de baixar.

O formulário mora **no Notion**, e não no backend do projeto. Foi decisão
explícita: esta página é estática de propósito, e acoplá-la ao Nest por causa
de um punhado de pedidos custaria um módulo, um modelo no Prisma, rate limit e
CORS — para um volume que cabe numa base do Notion.

É o **embed** do Notion num `<iframe>`, não um `<form>` próprio: o formulário
do Notion é página hospedada e não aceita `POST` de fora. Embutir em vez de
linkar resolve o problema que o Notion cria — ele não faz redirect após o envio,
então a confirmação aparece **dentro do iframe** e a pessoa não sai da página.

Isso torna o texto de confirmação configurado no Notion parte da interface, não
um detalhe: é onde vai o aviso de que o convite da Apple **precisa** ser aceito,
e é exatamente o ponto onde as pessoas fecham a aba e esquecem.

Detalhes do embed que não são óbvios:

- **Altura fixa no CSS.** Um iframe cross-origin não informa a própria altura
  para fora; não há como esta página saber o tamanho do conteúdo do Notion. O
  iframe rola por dentro. O valor **sobe** no celular (40rem contra 34rem), não
  desce: com 375px os campos empilham e o formulário fica mais alto.
- **`loading="lazy"`.** No Android o bloco está escondido, e quem baixa o APK
  não deve pagar o download de um iframe que nunca vai ver.
- **Há um link de escape** logo abaixo, para o caso de o iframe não carregar
  (bloqueador de terceiros, rede da universidade, Notion fora do ar). Sem ele,
  quem for bloqueado fica sem caminho nenhum.

Conferido em 2026-08-23: o `notion.site` responde `frame-ancestors https: http:`
e nenhum `X-Frame-Options`, ou seja, permite ser embutido de qualquer origem.

### O que o formulário pede

Três campos, e nenhum a mais — cada campo extra derruba conversão:

| Campo | Tipo | Por quê |
|---|---|---|
| Apple ID | Email, obrigatório | O único dado que vai para o App Store Connect. |
| Nome | Text, obrigatório | Sem ele a base é uma lista de emails anônimos. |
| Quem te indicou | Text, obrigatório | O alcance é amigo-de-amigo; é o único filtro, e com teto de 100 vagas a origem importa. |

Não pedir curso, semestre nem matrícula: não são usados, e são atrito à toa.

Vale uma coluna **Status** (`pendente` / `convidado` / `aceitou`) na base: a
Apple não avisa quando alguém aceita o convite, então não há como saber sem
conferir na mão.

Dois limites que valem lembrar quando isso apertar:

- **Teto de 100 testadores internos**, e cada um precisa ser membro da equipe
  no App Store Connect (aceitar convite com Apple ID e 2FA).
- Quando encher, o próximo passo **não** é automatizar o convite via API — é
  abrir o beta externo: link público, sem teto de 100, e ninguém entra na conta
  de desenvolvedor. O custo é passar pela Beta App Review.

## Preencher antes de publicar

O `index.html` tem lacunas explícitas entre colchetes. Nenhum número foi
inventado — todos precisam vir da release real (o formulário do iOS já está
apontado para o embed real, não é lacuna):

- `[URL_DO_APK]` — o asset do GitHub Release (não o artefato do EAS Build, cuja
  URL expira)
- `[VERSÃO]`, `[TAMANHO]`, `[DATA]`
- `[O QUE MUDOU]` e `[ANTERIOR]` no bloco de versões

## O vídeo

Há um bloco `<video>` comentado no `index.html`, logo antes do botão. Quando o
MP4 e o poster frame existirem, coloque-os neste diretório e descomente.

Ele fica **depois** do botão de propósito: a página foi desenhada para entregar
o download antes de qualquer argumento de venda.

## Publicar

Estático puro — qualquer host serve. Cloudflare Pages ou GitHub Pages apontando
para este diretório, e o subdomínio no DNS do domínio já existente.

> Anotar aqui qual host foi escolhido, assim que estiver no ar.

## Conferido

Renderizado em 375px e 1280px, nos três estados (`is-other`, `is-ios` e sem
classe nenhuma): sem estouro horizontal em nenhum, e os dois botões com 44px de
altura no celular (mínimo de alvo de toque) e 40px no desktop, que é o
comportamento do próprio `.button--lg` do HeroUI acima de 768px.
