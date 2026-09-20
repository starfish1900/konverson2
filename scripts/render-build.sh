#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

# Render can supply read-only system Rust homes. Always use this checkout's
# writable toolchain, including when build-wasm.mjs starts wasm-pack.
export KONVERSON_RUST_HOME="$project_root/.tools"
export CARGO_HOME="$KONVERSON_RUST_HOME/cargo"
export RUSTUP_HOME="$KONVERSON_RUST_HOME/rustup"
export RUSTUP_TOOLCHAIN="1.98.1"
export PATH="$CARGO_HOME/bin:$PATH"
mkdir -p "$CARGO_HOME" "$RUSTUP_HOME"

# A system rustup on PATH does not provide writable local cargo/rustc proxies.
if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
"$CARGO_HOME/bin/rustup" toolchain install "$RUSTUP_TOOLCHAIN" --profile minimal --no-self-update
"$CARGO_HOME/bin/rustup" target add wasm32-unknown-unknown --toolchain "$RUSTUP_TOOLCHAIN"
npm ci
npm run build
