# Como lançar uma versão do app

O app não vai pra Play Store. Isso significa que duas coisas que a loja fazia
por você agora são suas: **garantir que a atualização instala por cima da
anterior** e **avisar que existe versão nova**.

Este documento cobre as duas.

---

## Parte 1 — A keystore

### O que é

Todo APK Android é assinado com uma chave criptográfica. Quando o sistema
instala um app por cima de outro, ele compara a assinatura do arquivo novo com
a do app já instalado. Se baterem, é uma **atualização**: o app é substituído
no lugar e os dados sobrevivem — SecureStore, credenciais do SIGAA, preferência
de tema, tudo.

Se não baterem, o Android recusa a instalação com "app não instalado". Não há
opção de forçar. O usuário só consegue prosseguir **desinstalando o app
primeiro**, o que apaga os dados dele.

### Por que isso é irreversível

Não existe recuperação. Se a chave se perder ou mudar, todo mundo que já
instalou fica preso na versão que tem, e a única saída é pedir que desinstalem
e reinstalem, perdendo os dados locais.

É a decisão mais cara deste projeto justamente por não ter conserto remoto — e
por só aparecer meses depois, quando já tem gente com o app instalado.

### Como isso dá errado sem ninguém perceber

O caminho mais comum é este:

1. Os primeiros APKs saem de build local, assinados com a keystore de **debug**.
2. Mais tarde, migra-se para o EAS Build, que **gera uma keystore própria**.
3. A assinatura muda. Todo mundo que instalou trava.

Ninguém erra "de propósito": a troca acontece de graça, ao mudar de ferramenta.

### A regra

**Escolha uma keystore antes da primeira release pública, guarde-a com backup,
e nunca troque.** Os dois caminhos de build (local ou EAS) são válidos — o que
não pode é alternar entre chaves diferentes.

### Qual é a keystore deste projeto

> **A DEFINIR.** Preencher aqui antes da primeira release pública:
>
> - Caminho: `___`
> - Gerenciada por: `EAS` ou `local`
> - Onde está o backup: `___`
> - Backup conferido em: `___`

**Se for EAS.** O EAS gera e guarda a chave. Baixe o backup uma vez:

```bash
eas credentials
```

Escolha Android › o perfil de produção › Keystore › Download. Guarde o arquivo
**e a senha** fora do repositório — gerenciador de senhas ou cofre. Não commite:
qualquer pessoa com a keystore consegue assinar um APK que o Android vai aceitar
como sendo o seu app.

**Se for local.** Gere uma vez e guarde do mesmo jeito:

```bash
keytool -genkeypair -v -keystore gradline-release.keystore -alias gradline -keyalg RSA -keysize 2048 -validity 10000
```

`-validity 10000` são ~27 anos. Uma chave que expira é o mesmo problema com
data marcada.

---

## Parte 2 — O processo de release

Cinco passos manuais. Nenhum é automatizado (decisão registrada na spec: com
poucas releases por ano, o checklist custa menos que manter um workflow).

### 1. Subir a versão

Em `mobile/app.json`, os dois campos **sempre juntos**:

- `expo.version` — semver, é o que o usuário vê e o que o app compara
- `expo.android.versionCode` — inteiro, +1

O `versionCode` não é decoração: o Android **recusa** instalar um APK cujo
`versionCode` seja menor ou igual ao instalado. Esquecer de subir esse número
faz a atualização ser rejeitada pelo sistema, sem mensagem útil.

### 2. Buildar

Com EAS, o perfil precisa pedir APK explicitamente — o padrão é AAB, que só
serve pra loja:

```json
{ "build": { "production": { "android": { "buildType": "apk" } } } }
```

```bash
eas build --platform android --profile production
```

O plano grátis dá 15 builds Android por mês.

Alternativa local: `expo prebuild` e depois `./gradlew assembleRelease` em
`android/`, com a mesma keystore configurada.

### 3. Publicar no GitHub Releases

Baixe o artefato do EAS e suba como asset:

```bash
gh release create v1.1.0 ./gradline-1.1.0.apk --title "v1.1.0" --notes "..."
```

**Não linke a URL do EAS direto** — ela expira. A URL do asset do GitHub é
estável, e é ela que vai no passo seguinte e na landing.

### 4. Apontar o endpoint pra nova versão

```bash
railway variables --set APP_LATEST_VERSION=1.1.0 \
  --set APP_LATEST_VERSION_CODE=3 \
  --set APP_DOWNLOAD_URL=https://github.com/<owner>/<repo>/releases/download/v1.1.0/gradline-1.1.0.apk \
  --set APP_RELEASE_NOTES="Optativas na Trajetória." \
  --set APP_PUBLISHED_AT=2026-09-01T12:00:00Z
```

**É este passo — e só ele — que lança a versão.** Enquanto as variáveis não
mudarem, o APK está publicado e ninguém é avisado.

Isso dá duas coisas de graça:

- **Controle do momento.** Você builda e publica quando der, e divulga quando
  quiser.
- **Rollback instantâneo.** Deu ruim? Aponte as variáveis de volta pra versão
  anterior. Os apps voltam a não ver atualização, sem rebuild e sem republicar
  nada. Quem já instalou a versão ruim continua com ela — mas ninguém novo cai
  nela.

Se qualquer variável obrigatória faltar ou o `versionCode` não for inteiro, o
`GET /app/version` responde 404 e o app trata como "sem atualização". Falhar em
silêncio é o comportamento desejado: uma configuração pela metade não vira aviso
quebrado no celular de ninguém.

### 5. Atualizar a landing

Em `landing/index.html`, preencher `[URL_DO_APK]`, `[VERSÃO]`, `[TAMANHO]`,
`[DATA]` e o bloco de versões. Publicar o diretório.

Isso é só pra quem chega pelo site — quem já tem o app foi avisado no passo 4.

---

## As variáveis de ambiente

Lidas por `backend/src/app-release/app-release.service.ts` e servidas em
`GET /app/version`, público e sem autenticação.

| Variável | Exemplo | Obrigatória |
|---|---|---|
| `APP_LATEST_VERSION` | `1.1.0` | sim |
| `APP_LATEST_VERSION_CODE` | `3` | sim (inteiro) |
| `APP_DOWNLOAD_URL` | `https://github.com/.../gradline-1.1.0.apk` | sim |
| `APP_PUBLISHED_AT` | `2026-09-01T12:00:00Z` | sim (ISO 8601) |
| `APP_RELEASE_NOTES` | `Optativas na Trajetória.` | não (vazio = sem notas) |

---

## Checklist

- [ ] `expo.version` e `expo.android.versionCode` subiram juntos
- [ ] Build feito com **a** keystore
- [ ] APK no GitHub Releases, com changelog
- [ ] Variáveis do Railway apontando pro release novo
- [ ] Landing atualizada
- [ ] Instalado por cima da versão anterior num aparelho real, confirmando que
      os dados sobreviveram
