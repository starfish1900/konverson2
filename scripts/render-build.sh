#!/usr/bin/env bash
set -euo pipefail
export CARGO_HOME="${CARGO_HOME:-$PWD/.tools/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$PWD/.tools/rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.98.1
fi
rustup toolchain install 1.98.1 --profile minimal
rustup target add wasm32-unknown-unknown --toolchain 1.98.1
npm ci
npm run build
