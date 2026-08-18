#!/usr/bin/env bash
# Carrega o toolchain que o repo exige e executa o comando dado.
#
# POR QUE ISTO EXISTE. Num shell interativo de login o DEV1 resolve node v24.13.0 e
# pnpm 11.5.2, que e o que o repo pede. Numa invocacao nao-interativa -- `ssh host
# 'cmd'`, cron, script de deploy, passo de CI que faz ssh -- ele resolve node v18.19.1
# e pnpm 9.15.9, e o motivo e banal:
#
#   - ~/.bashrc aborta na linha 5 ("If not running interactively, don't do anything")
#     antes de chegar ao carregamento do nvm, que fica na linha 120;
#   - ~/.profile, que poe ~/.local/bin no PATH -- onde vive o pnpm da versao do
#     packageManager --, so e lido por shell de LOGIN.
#
# `ssh host 'cmd'` nao e interativo nem de login, entao nenhum dos dois roda.
#
# O SINTOMA E ENGANOSO, e vale registrar porque custou tempo. Nenhuma das duas metades
# funciona sozinha: com o PATH de login mas node 18, o pnpm 11.5.2 e encontrado e SE
# RECUSA A RODAR ("requires at least Node.js v22.13"); com node 24 mas sem
# ~/.local/bin, o PATH cai no pnpm 9.15.9 e o engines.pnpm do repo rejeita. As duas
# falhas juntas parecem "versao errada instalada" quando sao ordem de PATH.
#
# USO:
#   ./scripts/dev-env.sh pnpm install --frozen-lockfile
#   ./scripts/dev-env.sh pnpm run test:unit:ci
#   ssh DEV1 'cd /home/rt/scripts/viewers && ./scripts/dev-env.sh pnpm -v'
#
# O script VERIFICA e nao assume: se o node ou o pnpm resolvido nao for o exigido, ele
# falha aqui, em vez de deixar um `pnpm install` rodar com a versao errada e produzir um
# node_modules que so funciona nesta maquina.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() {
  printf 'dev-env: %s\n' "$1" >&2
  exit 1
}

if [ "$#" -eq 0 ]; then
  die 'uso: dev-env.sh <comando> [args...]  (ex: dev-env.sh pnpm install --frozen-lockfile)'
fi

# --- node ------------------------------------------------------------------

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] || die "nvm nao encontrado em $NVM_DIR -- instale o nvm ou ponha node >= 24 no PATH"

# nvm.sh usa variaveis nao definidas; o set -u tem de sair durante o source.
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
set -u

wanted_node='24'
if [ -f "$repo_root/.node-version" ]; then
  wanted_node="$(tr -d ' \t\r\n' < "$repo_root/.node-version")"
fi

# Tenta a versao exata do .node-version e cai para a major. O DEV1 tem 24.13.0 e o
# repo pede 24.15.0: a major e o que decide compatibilidade de engines, e falhar por
# um patch faria o shim ser contornado a mao, que e pior.
if ! nvm use "$wanted_node" >/dev/null 2>&1; then
  wanted_major="${wanted_node%%.*}"
  nvm use "$wanted_major" >/dev/null 2>&1 \
    || die "nvm nao tem node $wanted_node nem a major $wanted_major -- rode: nvm install $wanted_node"
fi

# --- pnpm ------------------------------------------------------------------

# ~/.local/bin ANTES do que ja existe: e la que vive o pnpm da versao do
# packageManager, e /usr/local/bin tem um pnpm mais antigo que venceria.
if [ -d "$HOME/.local/bin" ]; then
  PATH="$HOME/.local/bin:$PATH"
fi
export PATH

# --- verificacao -----------------------------------------------------------

node_version="$(node -v 2>/dev/null || echo 'ausente')"
node_major="$(printf '%s' "${node_version#v}" | cut -d. -f1)"
case "$node_major" in
  ''|*[!0-9]*) die "node nao resolveu para uma versao utilizavel (obtive '$node_version')" ;;
esac
[ "$node_major" -ge 24 ] || die "node $node_version resolvido, mas o repo exige engines.node >= 24"

# A versao exigida sai do proprio package.json, para o shim nao virar um segundo
# lugar onde a versao do pnpm e declarada e possa divergir do repo.
wanted_pnpm=''
if [ -f "$repo_root/package.json" ]; then
  wanted_pnpm="$(node -e '
    try {
      const pm = require("'"$repo_root"'/package.json").packageManager || "";
      const m = /^pnpm@(.+)$/.exec(pm);
      process.stdout.write(m ? m[1] : "");
    } catch (e) { process.stdout.write(""); }
  ' 2>/dev/null || true)"
fi

pnpm_version="$(pnpm --version 2>/dev/null || echo 'ausente')"
if [ -n "$wanted_pnpm" ] && [ "$pnpm_version" != "$wanted_pnpm" ]; then
  die "pnpm resolvido e $pnpm_version ($(command -v pnpm 2>/dev/null || echo 'nao encontrado')) mas o packageManager do repo pede $wanted_pnpm -- um install com a versao errada produz um node_modules que so funciona nesta maquina"
fi

if [ "${DEV_ENV_VERBOSE:-}" = '1' ]; then
  printf 'dev-env: node %s, pnpm %s (%s)\n' "$node_version" "$pnpm_version" "$(command -v pnpm)" >&2
fi

exec "$@"
