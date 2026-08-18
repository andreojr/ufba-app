#!/bin/bash
# Rode este script no SEU terminal, digite seu usuário/senha reais quando pedido.
# Nada aqui é enviado a mim (Claude) — só me diga o resultado impresso no final.

read -p "Usuário SIGAA: " SIGAA_USER
read -s -p "Senha SIGAA: " SIGAA_PASS
echo

JAR=$(mktemp)

echo "== 1. Estabelecendo sessão =="
curl -s -o /dev/null -c "$JAR" -b "$JAR" "https://sigaa.ufba.br/sigaa/verTelaLogin.do"

echo "== 2. Enviando login real =="
RESP_HEADERS=$(curl -s -D - -o /tmp/sigaa_real_login_body.html -c "$JAR" -b "$JAR" \
  -X POST "https://sigaa.ufba.br/sigaa/logar.do?dispatch=logOn" \
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
if grep -q 'loginForm' /tmp/sigaa_real_login_body.html; then
  echo "=> Detectado: página de login retornou de novo (provável falha de login ou senha incorreta)."
else
  echo "=> Login parece ter tido sucesso (não retornou o form de login)."
fi
echo "================================================================"

unset SIGAA_PASS
rm -f "$JAR" /tmp/sigaa_real_login_body.html