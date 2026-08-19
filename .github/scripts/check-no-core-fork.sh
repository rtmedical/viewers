#!/usr/bin/env bash
# RTV-114 — Gate de arquitetura: falha se a PR forka/altera pacotes core do OHIF.
# Política completa em ARCH.md (raiz do repo). Rodável localmente e no CI.
#
# Uso:
#   .github/scripts/check-no-core-fork.sh [BASE_REF]
#   BASE_REF default: $GITHUB_BASE_REF (CI) -> origin/master -> HEAD~1
#
# Falha (exit 1) se algum arquivo ALTERADO casar com:
#   - node_modules/@ohif/<core>/...        (fork direto de pacote core)
#   - patches/@ohif+<core>*.patch          (patch-package em pacote core)
#   - extensions|modes/**/@ohif/<core>/... (cópia de código core para dentro do repo)
#   - o DIRETÓRIO do pacote core neste monorepo (ver CORE_PATHS abaixo)
#
# A última regra é uma correção de 19/08/2026. As três primeiras casam o literal
# "@ohif/<core>" no caminho, e nenhuma delas casa com `platform/core/src/foo.ts` --
# que é onde @ohif/core REALMENTE mora neste monorepo. O guard dava ✅ para uma
# edição direta na lógica do core, que é justamente a forma fácil de violar o
# ARCH.md. Auditado no range desde o último CI verde: nenhum commit de feature havia
# tocado esses diretórios, então o buraco não foi explorado -- mas estava aberto.
set -euo pipefail

# Pacotes core que NÃO podem ser modificados (ver ARCH.md "NÃO fazer").
CORE_PKGS=(
  "core"
  "app"
  "ui"
  "ui-next"
  "extension-cornerstone"
  "extension-default"
  "extension-cornerstone-dicom-sr"
  "extension-cornerstone-dicom-seg"
)

# Onde cada um desses pacotes vive NESTE repo. Conferido com o campo "name" de cada
# package.json: platform/core é @ohif/core, extensions/cornerstone é
# @ohif/extension-cornerstone, e assim por diante.
CORE_PATHS=(
  "platform/core"
  "platform/app"
  "platform/ui"
  "platform/ui-next"
  "extensions/cornerstone"
  "extensions/default"
  "extensions/cornerstone-dicom-sr"
  "extensions/cornerstone-dicom-seg"
)

# Exceções dentro dos diretórios acima: pontos de integração sancionados, não código
# core. Registrar uma extensão tem de acontecer em algum lugar, e é aqui.
#   - pluginConfig.json: manifesto de extensões registradas
#   - public/config/*: configuração de runtime do app (datasources, hanging protocols)
CORE_PATH_ALLOW=(
  "platform/app/pluginConfig.json"
  "platform/app/public/config/"
)

# Resolve a base de comparação.
BASE="${1:-}"
if [[ -z "${BASE}" ]]; then
  if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    BASE="origin/${GITHUB_BASE_REF}"
  elif git rev-parse --verify -q origin/master >/dev/null; then
    BASE="origin/master"
  else
    BASE="HEAD~1"
  fi
fi

echo "RTV-114 arch-guard: comparando contra base '${BASE}'"
if ! CHANGED=$(git diff --name-only "${BASE}"...HEAD 2>/dev/null); then
  # fallback: arquivos staged/working tree (uso local sem range válido)
  CHANGED=$(git diff --name-only HEAD 2>/dev/null || true)
fi

if [[ -z "${CHANGED}" ]]; then
  echo "Nenhum arquivo alterado detectado — OK."
  exit 0
fi

# Monta o alternation regex dos pacotes core: (core|app|ui|...)
ALT=$(IFS='|'; echo "${CORE_PKGS[*]}")

is_allowed_core_path() {
  local f="$1" allow
  for allow in "${CORE_PATH_ALLOW[@]}"; do
    if [[ "${allow}" == */ ]]; then
      [[ "${f}" == "${allow}"* ]] && return 0
    else
      [[ "${f}" == "${allow}" ]] && return 0
    fi
  done
  return 1
}

# Padrões proibidos.
VIOLATIONS=""
CORE_EDITS=""
while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  if [[ "${f}" =~ ^node_modules/@ohif/(${ALT})(/|$) ]] \
     || [[ "${f}" =~ ^patches/@ohif\+(${ALT}) ]] \
     || [[ "${f}" =~ /node_modules/@ohif/(${ALT})(/|$) ]] \
     || [[ "${f}" =~ @ohif/(${ALT})/.*\.(ts|tsx|js|jsx)$ && "${f}" =~ ^(extensions|modes|platform)/ ]]; then
    VIOLATIONS+="  - ${f}"$'\n'
    continue
  fi
  for dir in "${CORE_PATHS[@]}"; do
    if [[ "${f}" == "${dir}/"* ]]; then
      if ! is_allowed_core_path "${f}"; then
        CORE_EDITS+="  - ${f}"$'\n'
      fi
      break
    fi
  done
done <<< "${CHANGED}"

if [[ -n "${VIOLATIONS}" ]]; then
  echo ""
  echo "❌ RTV-114 VIOLADO — esta PR modifica pacote(s) core do OHIF:"
  echo "${VIOLATIONS}"
  echo "Política (ARCH.md): use CustomizationService → Extension → Mode → hooks."
  echo "Se acha que precisa forkar o core, ESCALE antes (provavelmente há um customization point)."
  exit 1
fi

if [[ -n "${CORE_EDITS}" ]]; then
  # Sync de upstream e bump de versão legitimamente tocam o core. A dispensa é
  # explícita e RUIDOSA de propósito: fica no log, nomeando os arquivos, para que
  # ninguém a use sem que apareça na revisão. Não é uma barreira de segurança -- é
  # disciplina, e o ARCH.md já manda escalar.
  if [[ "${ARCH_GUARD_WAIVE_CORE:-}" == "1" ]]; then
    echo ""
    echo "⚠️  RTV-114 DISPENSADO por ARCH_GUARD_WAIVE_CORE=1 — pacote core alterado:"
    echo "${CORE_EDITS}"
    echo "Motivo esperado: sync de upstream ou bump de versão. Confira na revisão."
    exit 0
  fi
  echo ""
  echo "❌ RTV-114 VIOLADO — esta PR altera o diretório de um pacote core do OHIF:"
  echo "${CORE_EDITS}"
  echo "Esses diretórios SÃO os pacotes core neste monorepo (platform/core é @ohif/core)."
  echo "Política (ARCH.md): use CustomizationService → Extension → Mode → hooks."
  echo ""
  echo "Pontos de integração permitidos, se era isso que você queria:"
  for allow in "${CORE_PATH_ALLOW[@]}"; do
    echo "  - ${allow}"
  done
  echo ""
  echo "Se é sync de upstream ou bump de versão, rode com ARCH_GUARD_WAIVE_CORE=1."
  exit 1
fi

echo "✅ RTV-114 OK — nenhuma modificação em pacote core do OHIF."
exit 0
