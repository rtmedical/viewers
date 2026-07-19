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

# Padrões proibidos.
VIOLATIONS=""
while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  if [[ "${f}" =~ ^node_modules/@ohif/(${ALT})(/|$) ]] \
     || [[ "${f}" =~ ^patches/@ohif\+(${ALT}) ]] \
     || [[ "${f}" =~ /node_modules/@ohif/(${ALT})(/|$) ]] \
     || [[ "${f}" =~ @ohif/(${ALT})/.*\.(ts|tsx|js|jsx)$ && "${f}" =~ ^(extensions|modes|platform)/ ]]; then
    VIOLATIONS+="  - ${f}"$'\n'
  fi
done <<< "${CHANGED}"

if [[ -n "${VIOLATIONS}" ]]; then
  echo ""
  echo "❌ RTV-114 VIOLADO — esta PR modifica pacote(s) core do OHIF:"
  echo "${VIOLATIONS}"
  echo "Política (ARCH.md): use CustomizationService → Extension → Mode → hooks."
  echo "Se acha que precisa forkar o core, ESCALE antes (provavelmente há um customization point)."
  exit 1
fi

echo "✅ RTV-114 OK — nenhuma modificação em pacote core do OHIF."
exit 0
