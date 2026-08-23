# Distribuição e atualização do app (fora da loja) — design spec

## Motivation

O app não vai pra Play Store nem pra App Store. É hobby, sem receita, e o único
custo que o autor assume é o servidor no Railway. Isso resolve o problema de
"como o usuário instala" com um APK hospedado por conta própria — mas deixa
aberto o problema que importa mais: **como uma versão nova chega em quem já tem
o app instalado**.

Hoje não chega. Um APK instalado é um beco sem saída: não há loja pra atualizar
em background, o app não sabe a própria versão, não sabe qual é a última, e não
tem como avisar ninguém. Na prática, toda melhoria feita depois da v1 só
existiria pra quem reinstalasse por acaso.

Isso torna esta entrega pré-requisito de todas as outras do roadmap. Sem canal
de atualização, as features A, B e C do ciclo atual são entregues pro vazio.

## Escopo

**Nesta entrega:**

- O app passa a conhecer a própria versão e a exibi-la explicitamente na tela de
  Perfil/Ajustes.
- Endpoint público no backend que informa qual é a última versão publicada.
- Aviso de atualização na Home quando houver versão nova, dispensável por versão.
- **Download e instalação dentro do próprio app**: o APK é baixado pra área
  privada do app, o instalador do sistema é disparado, e o arquivo é apagado
  depois — sem o usuário sair pro navegador e sem lixo na pasta Downloads.
- Landing page estática em subdomínio próprio, como porta de entrada pra quem
  ainda **não** tem o app (e fallback pra quem não conseguir instalar por dentro).
- Definição e congelamento da keystore de assinatura.
- Processo de release documentado.

**Fora de escopo, deliberadamente:**

- **OTA (`expo-updates`).** Rejeitado com fundamento — ver "Por que não OTA".
- **Bloqueio por versão mínima** (`minSupportedVersion`). O caso que ele resolve
  — backend quebra compatibilidade e o app velho passa a dar erro sem explicação
  — ainda não existe. Entra quando existir; o formato de resposta do endpoint já
  deixa espaço pro campo.
- **Automação do release por CI.** Enquanto forem poucas releases por ano, o
  checklist manual custa menos que manter workflow.
- **iOS.** Sem conta de desenvolvedor Apple ($99/ano) não há distribuição
  possível fora da loja. A landing declara isso honestamente em vez de omitir.

## Por que não OTA

Registrado aqui porque a decisão foi tomada contra uma inclinação inicial
oposta, e o raciocínio precisa sobreviver ao esquecimento.

O OTA (bundle JS novo baixado em background, aplicado no próximo cold start) é
o que faz apps grandes "mudarem sozinhos". Foi considerado seriamente, via EAS
Update (plano grátis: 1.000 MAU, 100 GiB de banda, 20 GiB de storage, sem
cobrança por excedente — trava e para de atualizar) ou self-hosted. Descartado
por três razões:

1. **O valor escala com frequência de release; o custo é fixo.** Este app é
   deliberadamente pequeno e vai entrar em manutenção depois da v1. Meia dúzia
   de mudanças por ano não paga disciplina permanente de `runtimeVersion`, conta
   EAS viva e canal configurado.
2. **O cenário de emergência não se aplica.** O argumento mais forte pró-OTA
   seria "a UFBA mudou o HTML do SIGAA e o app parou pra todo mundo". Mas
   **não há parsing de HTML no `mobile/src`** — todo o scraping vive em
   `backend/src/sigaa-engine/`. Correção de parser é deploy no Railway, que já
   chega instantâneo em todos os usuários sem ninguém instalar nada. O mobile é
   cliente magro: só muda quando se quer feature nova.
3. **Risco assimétrico.** Um bundle ruim publicado por OTA chega em todo mundo
   de uma vez, silenciosamente. O `expo-updates` faz rollback quando o app
   quebra no launch, mas é uma classe de incidente que simplesmente não existe
   sem OTA.

O corolário importante: **sem OTA, o APK é o único canal**, e por isso vale
pagar o custo *único* do download-e-instala embutido (trabalho nativo de uma
vez, manutenção zero depois) em vez do custo *recorrente* do OTA.

## Pré-requisito: SDK 57

Esta entrega assume o app no **Expo SDK 57** (RN 0.86, React 19.2), feito na
branch `upgrade-sdk-57`. O upgrade não é cosmético para esta spec: é o que traz
o `onProgress` no download, e foi feito antes da primeira release pública
justamente porque, depois dela, um upgrade de SDK vira uma atualização nativa
que precisa alcançar todo mundo — sem OTA, sem rollback remoto.

## Fonte da verdade da versão

`mobile/app.json` é a fonte única:

- `expo.version` (`"1.0.0"`) — a versão legível, comparada por semver.
- `expo.android.versionCode` — **não existe hoje e passa a existir**. Inteiro
  monotônico. O Android recusa instalar um APK com `versionCode` menor ou igual
  ao instalado; sem esse campo subindo a cada release, a atualização é recusada
  pelo sistema.

O app lê a própria versão com `expo-constants`
(`Constants.expoConfig?.version`), que já está nas dependências.
`expo-application` seria mais correto (lê do binário instalado, não do
manifest), mas é módulo nativo e o ganho não justifica — nesta arquitetura, sem
OTA, o manifest embarcado e o binário nunca divergem.

## Assinatura (decisão irreversível)

Instalar um APK por cima de outro é update no lugar — preserva dados do
SecureStore e caches, não duplica o app — **desde que** o `applicationId`
(`com.gradline.ufba`) e a **chave de assinatura** sejam os mesmos.

Se a chave mudar, o Android recusa com "app não instalado" e o usuário só
prossegue desinstalando primeiro, **perdendo os dados locais**. Isso acontece
silenciosamente ao migrar de um build local (keystore de debug) pro EAS Build
(que gera keystore própria).

Portanto, antes da primeira release pública: escolher **uma** keystore, guardar
o arquivo e a senha em local seguro e com backup, e nunca trocar. A escolha
entre build local e EAS Build (15 builds Android/mês no plano grátis) é livre,
mas a keystore tem que ser a mesma nos dois casos.

## Backend

Módulo Nest novo, seguindo o padrão dos existentes em `backend/src/`.

`GET /app/version` — **público, sem autenticação** (o app precisa checar antes
de qualquer login).

```json
{
  "latestVersion": "1.1.0",
  "versionCode": 3,
  "downloadUrl": "https://github.com/<owner>/<repo>/releases/download/v1.1.0/gradline-1.1.0.apk",
  "releaseNotes": "Optativas na Trajetória. Correção no cálculo do CR.",
  "publishedAt": "2026-09-01T12:00:00Z"
}
```

Os valores vêm de **variáveis de ambiente do Railway**
(`APP_LATEST_VERSION`, `APP_LATEST_VERSION_CODE`, `APP_DOWNLOAD_URL`,
`APP_RELEASE_NOTES`, `APP_PUBLISHED_AT`). Sem tabela, sem migração, sem tela de
admin: publicar uma versão é setar variáveis. Se algum dia isso virar histórico
de releases, migra pra tabela — o contrato da resposta não muda.

O campo `minSupportedVersion` fica reservado no contrato mas não é emitido nem
consumido nesta entrega.

## Onde mora o APK

**GitHub Releases.** Grátis, versionado, URL estável, changelog no mesmo lugar.

Se o build sair do EAS Build, **não linkar o artefato do EAS direto** — aquelas
URLs expiram. Baixar o APK e subir como asset do Release.

## Mobile

### Lógica pura

`src/lib/app-version.ts` — sem I/O, testável isolada, no padrão dos outros
`lib/*.test.ts`:

- `compararVersoes(a, b)` — comparação semver, retorna -1/0/1.
- `haAtualizacao(instalada, ultima)` — booleano. Toda a decisão mora aqui; a UI
  só consome o resultado.

### Rede

`getAppVersion()` em `src/lib/api.ts`, seguindo o padrão existente
(`process.env.EXPO_PUBLIC_API_URL`, tratamento via `ApiError`).

**Regra dura:** falha, timeout ou backend fora do ar → **não mostra nada**.
Checagem de atualização nunca pode atrapalhar quem só quer ver a grade.

### Quando a checagem acontece

No cold start e ao voltar do background, **no máximo uma vez por hora** — o
timestamp da última checagem fica no SecureStore. Nunca bloqueia render: a tela
monta normalmente e o card aparece depois, se aparecer.

### O que é automático e o que não é

Da publicação até o app atualizado, o usuário dá **dois toques**:

1. O app checa sozinho e mostra o card — automático.
2. Usuário toca em "Atualizar" — **toque 1**.
3. O APK baixa em background com barra de progresso, e a intent de instalação é
   disparada — automático.
4. O sistema abre o diálogo "deseja instalar esta atualização?" e o usuário
   confirma — **toque 2**.
5. O app é substituído no lugar, dados preservados.

O toque 2 é imposto pelo Android e **não tem como ser removido**: nenhum app
comum instala pacote em silêncio. Silêncio total só existe via loja (que é o
daemon da Play Store instalando, não o app) ou com device-owner/MDM. Na primeira
vez, entra ainda uma ida às configurações pra liberar "instalar apps
desconhecidos" — uma vez por aparelho, não por atualização.

### Dispensa do aviso

`src/lib/app-update-storage.ts` — grava a versão dispensada no SecureStore
(mecanismo que `src/lib/theme-preference.ts` já usa), chave
`gradline.update-dismissed`. A dispensa é **por versão**: some agora, reaparece
quando sair a próxima.

### Download e instalação

`src/lib/app-update-install.ts`:

1. Baixa o APK de `downloadUrl` com `File.downloadFileAsync` (`expo-file-system`,
   já nas deps) pro diretório de cache do app — invisível na pasta Downloads e
   limpável pelo sistema sob pressão de armazenamento. O progresso vem do
   `onProgress`, com bytes reais.
2. Lê `File#contentUri` (o `content://` do FileProvider) e dispara a intent
   `android.intent.action.INSTALL_PACKAGE` com `FLAG_GRANT_READ_URI_PERMISSION`,
   usando `expo-intent-launcher`.
3. Apaga o arquivo depois de disparar a intent.

Se o usuário não tiver concedido "instalar apps desconhecidos", encaminha pra
`android.settings.MANAGE_UNKNOWN_APP_SOURCES`. Se qualquer etapa falhar, cai no
fallback de abrir a landing no navegador — o caminho manual nunca deixa de
existir.

**Nada de `expo-file-system/legacy`.** O subpath legacy está depreciado, e
adotá-lo criaria dívida de migração num app cujo objetivo declarado é parar de
exigir atenção. Não é preciso: desde a SDK 56 a API moderna cobre as duas coisas
que faltavam. Confirmado na 57.0.5:

- `File.downloadFileAsync(url, destino, { headers, idempotent, onProgress, signal })`
- `DownloadProgress { bytesWritten, totalBytes }`, com `totalBytes: -1` quando o
  servidor não manda `Content-Length`
- `File#contentUri` (Android), herdado de `FileSystemFile` — é o substituto do
  `getContentUriAsync`

Então o progresso é **medido**, não estimado. O card usa a mesma linguagem visual
do `DownloadProgressBar` do fluxo de histórico, mas **não reusa o componente**:
aquele encena progresso a partir de estágios conhecidos do backend, que não
existem aqui. Quando `totalBytes` vem `-1` não há fração, e o card mostra spinner
em vez de inventar um número.

### Mudanças nativas (exigem `expo prebuild` + rebuild)

- `android.versionCode` no `app.json`.
- Permissão `REQUEST_INSTALL_PACKAGES`.
- Dependência `expo-intent-launcher`.

Registrado explicitamente porque `android/` é artefato gitignored: adicionar
plugin ou permissão sem rodar `expo prebuild` produz um build que não reflete o
`app.json`.

### UI

- **Home** (`src/app/(tabs)/index.tsx`): card no topo quando há versão nova, com
  o `releaseNotes` curto, botão de atualizar e botão de dispensar.
- **Perfil/Ajustes** (`src/app/(tabs)/ajustes.tsx`): linha sempre visível com a
  versão instalada, indicando "atualizado" ou "nova versão disponível" — no
  padrão visual das linhas que já existem na tela.

## Landing page

Estática, em subdomínio de domínio já possuído. Hospedagem grátis (Cloudflare
Pages ou GitHub Pages) — sem custo novo no Railway.

Conteúdo:

- O que é o app, em duas frases.
- Botão de download do APK (aponta pro GitHub Release).
- **Instruções de "permitir instalação de apps desconhecidos"** — é onde todo
  mundo trava, e é o que mais economiza suporte.
- Changelog das versões.
- Nota honesta pro pessoal do iPhone: não há versão iOS, e por quê.

## Processo de release

Cinco passos manuais. Nenhum deles é automatizado nesta entrega (ver "Fora de
escopo"), mas cada um é um comando só.

**1. Subir a versão** em `mobile/app.json` — `expo.version` (semver, legível) e
`expo.android.versionCode` (inteiro, +1). Os dois sempre juntos: o primeiro é o
que o usuário vê e o que o app compara; o segundo é o que o Android exige pra
aceitar a instalação por cima.

**2. Buildar o APK.** Com EAS Build, o perfil precisa pedir APK explicitamente —
o padrão do EAS é AAB, que só serve pra loja:

```json
{ "build": { "production": { "android": { "buildType": "apk" } } } }
```

```bash
eas build --platform android --profile production
```

A keystore fica gerenciada pelo EAS (`eas credentials` permite baixar e fazer
backup — fazer isso uma vez e guardar). Alternativa local: `expo prebuild`
seguido de `./gradlew assembleRelease` em `android/`, com a mesma keystore
configurada. Os dois caminhos são válidos; o que não pode é alternar entre
keystores diferentes.

**3. Publicar no GitHub Releases.** Baixar o artefato do EAS (a URL dele expira)
e subir como asset:

```bash
gh release create v1.1.0 ./gradline-1.1.0.apk --title "v1.1.0" --notes "..."
```

A URL do asset é estável e é o que vai em `APP_DOWNLOAD_URL`.

**4. Apontar o endpoint pra nova versão.** É este passo — e só ele — que
"lança" a versão pros usuários. Enquanto as variáveis não mudarem, o APK novo
existe mas ninguém é avisado; o que dá controle sobre o momento da divulgação e
permite reverter instantaneamente apontando de volta pra versão anterior.

```bash
railway variables --set APP_LATEST_VERSION=1.1.0 --set APP_LATEST_VERSION_CODE=3 --set APP_DOWNLOAD_URL=... --set APP_RELEASE_NOTES=...
```

**5. Atualizar o changelog da landing** — só pra quem chega pelo site.

## Testing

- **Unitário**: `app-version.ts` — comparação semver incluindo casos de borda
  (versões iguais, instalada à frente da publicada, formato inválido).
- **Unitário**: dispensa por versão — dispensar 1.1.0 não esconde o aviso de
  1.2.0.
- **Integração (mock de rede)**: `getAppVersion()` — resposta boa, 5xx, timeout.
  Nos três casos de falha, nenhum aviso é renderizado.
- **RTL**: card da Home aparece/some conforme o booleano; linha de versão em
  Ajustes renderiza os dois estados.
- **Backend**: o endpoint responde sem autenticação e reflete as variáveis de
  ambiente.
- **Manual (não automatizável)**: instalar por cima com mesma assinatura preserva
  dados; `versionCode` menor é recusado pelo sistema; caminho de permissão
  negada cai no fallback do navegador.

## Open risks

- **Keystore.** É o risco irreversível da entrega. Errar aqui trava a
  atualização de toda a base instalada, sem conserto remoto.
- **FileProvider.** O `getContentUriAsync` do legacy chegou quebrado na SDK 54
  para alguns apps (`Couldn't find meta-data for provider with authority
  <package>.FileSystemFileProvider`, expo/expo#39056), e o `File#contentUri`
  depende do mesmo FileProvider. Teste unitário não pega — só instalar de
  verdade num aparelho revela.
- **Detecção de permissão.** Não há API Expo direta equivalente a
  `PackageManager.canRequestPackageInstalls()`. Provável necessidade de tentar a
  intent e tratar a falha, em vez de checar antes.
- **Play Protect e OEMs.** Alguns fabricantes exibem avisos extras pra APKs de
  fora da loja. Não é contornável; a landing deve preparar o usuário pra isso.
- **Usuário que dispensa e nunca mais atualiza.** Aceito nesta entrega. A linha
  permanente em Ajustes é a rede de segurança.
