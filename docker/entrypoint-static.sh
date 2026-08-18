#!/bin/sh
# Entrypoint do perfil static: valida o dist/ e substitui o template do nginx.
#
# Escopo deliberadamente menor que o de .docker/Viewer-v3.x/entrypoint.sh: aquele
# copia o dist, reescreve o app-config e resolve PUBLIC_URL em subcaminho. Aqui o
# dist entra por bind mount read-only e só o caso PUBLIC_URL=/ é suportado --
# reimplementar a resolução de subcaminho criaria duas lógicas que divergem, que é
# exatamente a falha que este stack existe para evitar.
set -eu

: "${PORT:=80}"
: "${PUBLIC_URL:=/}"

if [ "$PUBLIC_URL" != "/" ]; then
  echo "ERRO: o perfil static so suporta PUBLIC_URL=/ (recebi '$PUBLIC_URL')." >&2
  echo "Para servir em subcaminho use o perfil completo (Dockerfile + docker-compose.yml)," >&2
  echo "cujo entrypoint resolve PUBLIC_PATH e o bloco de redirect. Ver docs/plano-stack-dev-e-rtpy.md." >&2
  exit 1
fi

PUBLIC_PATH="/"
# ATENCAO: PUBLIC_PATH_REDIRECT nao e um caminho -- e um BLOCO DE DIRETIVAS nginx
# inteiro, que o template insere quando o app e servido em subcaminho. Com
# PUBLIC_URL=/ ele tem de ser VAZIO. Preenche-lo com "/" produz uma linha `/`
# solta e o nginx responde `unknown directive "/"`, que nao lembra a causa.
PUBLIC_PATH_REDIRECT=""

# export, e nao so atribuir: envsubst e processo filho e nao ve variavel de shell
# nao exportada. Sem isto o template sai com `listen  default_server;` e o nginx
# reclama de "host not found in default_server".
export PORT PUBLIC_PATH PUBLIC_PATH_REDIRECT

# Um nginx servindo diretorio vazio devolve 403, e o sintoma parece problema de
# permissao em vez de "esqueci de buildar".
if [ ! -f /usr/share/nginx/html/index.html ]; then
  echo "ERRO: /usr/share/nginx/html/index.html nao existe." >&2
  echo "" >&2
  echo "O perfil static NAO builda o viewer -- ele so serve um dist/ pronto." >&2
  echo "Rode 'pnpm build' fora desta maquina e monte o resultado em" >&2
  echo "  ./platform/app/dist  ->  /usr/share/nginx/html" >&2
  echo "Ver docs/plano-stack-dev-e-rtpy.md, secao 4.3." >&2
  exit 1
fi

if [ -f /usr/share/nginx/html/BUILD_INFO ]; then
  echo "dist/ em uso: $(cat /usr/share/nginx/html/BUILD_INFO)" >&2
else
  echo "AVISO: dist/ sem BUILD_INFO -- nao da para dizer de que commit ele veio." >&2
fi

envsubst '${PORT} ${PUBLIC_PATH} ${PUBLIC_PATH_REDIRECT}' \
  < /usr/src/default.conf.template > /etc/nginx/conf.d/default.conf

# Falhar aqui, e nao no primeiro request, quando o template gerar config invalida.
nginx -t

exec "$@"
