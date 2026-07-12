# Toolchain image that compiles the rt-dose-kernel crate to WASM.
# Uses a PREBUILT wasm-pack binary (no slow from-source cargo install).
# Build the wasm with ../build.sh (mounts the crate, outputs pkg/ to the host).
FROM rust:1-slim

ARG WASM_PACK_VERSION=0.13.1

RUN rustup target add wasm32-unknown-unknown \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -sSfL "https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      | tar -xz -C /usr/local/bin --strip-components=1 --wildcards '*/wasm-pack' \
 && wasm-pack --version

WORKDIR /crate
