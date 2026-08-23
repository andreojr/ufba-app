# Landing de download

Página estática que serve o APK para quem não tem o app instalado. Três
arquivos, nenhuma dependência em runtime, nenhum passo de build no deploy.

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

Leva menos de meio segundo. Saída atual: 51 KB, ~7,5 KB com gzip.

Depois pode apagar `node_modules` e `package*.json` — eles não fazem parte do
que é publicado.

## Preencher antes de publicar

O `index.html` tem lacunas explícitas entre colchetes. Nenhum número foi
inventado — todos precisam vir da release real:

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

Renderizado em 375px e 1280px: sem estouro horizontal, botão com 44px de
altura no celular (mínimo de alvo de toque) e 40px no desktop, que é o
comportamento do próprio `.button--lg` do HeroUI acima de 768px.
