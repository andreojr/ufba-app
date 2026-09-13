#!/bin/bash
# Rode este script no SEU terminal, digite seu usuário/senha reais quando pedido.
# Nada aqui é enviado a mim (Claude) — só me diga o resultado impresso no final.
#
# Além de dizer se o login passa, ele mostra as duas coisas que fazem o backend
# levar um "credenciais inválidas" sem a senha estar errada:
#   1. campos ocultos que o formulário passou a exigir e que não estávamos mandando;
#   2. a resposta mudar quando a requisição vai com cara de navegador.

BASE="https://sigaa.ufba.br"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

read -p "Usuário SIGAA: " SIGAA_USER
read -s -p "Senha SIGAA: " SIGAA_PASS
echo

JAR=$(mktemp)
LOGIN_PAGE=$(mktemp)
BODY=$(mktemp)

echo "== 1. Estabelecendo sessão =="
curl -s -o /dev/null -c "$JAR" -b "$JAR" -A "$UA" "$BASE/"
curl -s -o "$LOGIN_PAGE" -c "$JAR" -b "$JAR" -A "$UA" "$BASE/sigaa/verTelaLogin.do"

echo "== 2. Campos ocultos que o formulário de login declara =="
# Se aparecer aqui algum nome fora da lista conhecida (width, height, urlRedirect,
# subsistemaRedirect, acao, acessibilidade), é ele que estava faltando no POST.
grep -o '<input[^>]*type="hidden"[^>]*>' "$LOGIN_PAGE" |
  grep -o 'name="[^"]*"' | sort -u || echo "(nenhum encontrado)"

echo "== 3. Action declarado pelo formulário =="
grep -o '<form[^>]*name="loginForm"[^>]*>' "$LOGIN_PAGE" |
  grep -o 'action="[^"]*"' || echo "(não encontrado — a página de login veio diferente do esperado)"

echo "== 4. Enviando login real (com cabeçalhos de navegador) =="
RESP_HEADERS=$(curl -s -D - -o "$BODY" -c "$JAR" -b "$JAR" \
  -A "$UA" \
  -H "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8" \
  -H "Origin: $BASE" \
  -H "Referer: $BASE/sigaa/verTelaLogin.do" \
  -X POST "$BASE/sigaa/logar.do?dispatch=logOn" \
  --data-urlencode "width=1920" \
  --data-urlencode "height=1080" \
  --data-urlencode "urlRedirect=" \
  --data-urlencode "subsistemaRedirect=" \
  --data-urlencode "acao=" \
  --data-urlencode "acessibilidade=" \
  --data-urlencode "user.login=${SIGAA_USER}" \
  --data-urlencode "user.senha=${SIGAA_PASS}")

echo
echo "===== RESULTADO (pode compartilhar isso, não tem senha) ====="
echo "$RESP_HEADERS" | grep -Ei "^HTTP|^Location|^Set-Cookie"
echo
grep -o '<title>[^<]*</title>' "$BODY" | head -1
if grep -qi 'senha inválid\|usuário e/ou senha' "$BODY"; then
  echo "=> O SIGAA disse, com todas as letras, que usuário/senha estão errados."
elif grep -q 'loginForm' "$BODY"; then
  echo "=> A página de login voltou CALADA (sem dizer que a senha está errada)."
  echo "   É exatamente o caso que o backend lia como credencial inválida:"
  echo "   campo oculto faltando, bloqueio de borda ou manutenção."
else
  echo "=> Login parece ter tido sucesso (não voltou o formulário de login)."
fi
echo "================================================================"

unset SIGAA_PASS
rm -f "$JAR" "$LOGIN_PAGE" "$BODY"
