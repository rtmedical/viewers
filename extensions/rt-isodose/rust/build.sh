#!/usr/bin/env bash
# Compile the rt-dose-kernel crate to WASM via Docker (no host Rust toolchain).
# Outputs pkg/ (rt_dose_kernel.js + rt_dose_kernel_bg.wasm + .d.ts) next to this
# script for the JS loader to import. RTV Wave 4 / Phase 5.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

IMAGE=rt-dose-kernel-builder

echo ">> building toolchain image ($IMAGE)…"
docker build -t "$IMAGE" .

echo ">> compiling crate → pkg/ (wasm-pack, target web)…"
# Build as root (avoids wasm-pack cache/HOME permission issues), then chown the
# generated outputs back to the invoking host user so git can manage them.
UID_GID="$(id -u):$(id -g)"
docker run --rm \
  -v "$DIR":/crate \
  -w /crate \
  "$IMAGE" \
  bash -c "wasm-pack build --target web --release --out-dir pkg && chown -R ${UID_GID} pkg target Cargo.lock 2>/dev/null || true"

echo ">> done. pkg/ contents:"
ls -la "$DIR/pkg"
