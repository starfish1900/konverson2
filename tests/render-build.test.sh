#!/usr/bin/env bash
# Run with: bash tests/render-build.test.sh
# Exercise the deployment script without downloading tools or changing Rust.
set -euo pipefail
source_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/konverson-render-test.XXXXXX")"
trap 'rm -rf -- "$fixture_root"' EXIT
mkdir -p "$fixture_root/project with spaces/scripts" "$fixture_root/bin"
cp "$source_root/scripts/render-build.sh" "$fixture_root/project with spaces/scripts/"
export TEST_PROJECT="$fixture_root/project with spaces"
export TEST_LOG="$fixture_root/calls.log"
export TEST_STUBS="$fixture_root/bin"
export TEST_PATH="$TEST_STUBS:$PATH"

cat > "$TEST_STUBS/rustup" <<'STUB'
#!/usr/bin/env bash
echo 'ERROR: attempted to use system rustup' >&2
exit 91
STUB
cat > "$TEST_STUBS/local-rustup" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$CARGO_HOME" == "$TEST_PROJECT/.tools/cargo" ]]
[[ "$RUSTUP_HOME" == "$TEST_PROJECT/.tools/rustup" ]]
[[ "$RUSTUP_TOOLCHAIN" == '1.98.1' ]]
printf 'rustup %s\n' "$*" >> "$TEST_LOG"
[[ "${TEST_FAIL_RUSTUP:-0}" == 0 ]]
STUB
cat > "$TEST_STUBS/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo bootstrap >> "$TEST_LOG"
[[ "${TEST_FAIL_DOWNLOAD:-0}" == 0 ]] || exit 22
cat <<'INSTALLER'
set -eu
mkdir -p "$CARGO_HOME/bin"
cp "$TEST_STUBS/local-rustup" "$CARGO_HOME/bin/rustup"
chmod +x "$CARGO_HOME/bin/rustup"
INSTALLER
STUB
cat > "$TEST_STUBS/npm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$PWD" == "$TEST_PROJECT" ]]
[[ "$KONVERSON_RUST_HOME" == "$TEST_PROJECT/.tools" ]]
[[ "$CARGO_HOME" == "$TEST_PROJECT/.tools/cargo" ]]
[[ "$RUSTUP_HOME" == "$TEST_PROJECT/.tools/rustup" ]]
[[ "$(command -v rustup)" == "$CARGO_HOME/bin/rustup" ]]
printf 'npm %s\n' "$*" >> "$TEST_LOG"
STUB
chmod +x "$TEST_STUBS/"*

run_build() {
  # Match Render's inherited system homes and deliberately start elsewhere.
  env PATH="$TEST_PATH" CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup KONVERSON_RUST_HOME=/system/tools \
    RUSTUP_TOOLCHAIN=system-default \
    bash "$TEST_PROJECT/scripts/render-build.sh"
}

run_build
cat > "$fixture_root/expected.log" <<'EXPECTED'
bootstrap
rustup toolchain install 1.98.1 --profile minimal --no-self-update
rustup target add wasm32-unknown-unknown --toolchain 1.98.1
npm ci
npm run build
EXPECTED
diff -u "$fixture_root/expected.log" "$TEST_LOG"
echo 'PASS: fresh build overrides inherited system homes and bootstraps locally'

: > "$TEST_LOG"
run_build
tail -n +2 "$fixture_root/expected.log" > "$fixture_root/cached.log"
diff -u "$fixture_root/cached.log" "$TEST_LOG"
echo 'PASS: cached build reuses the project rustup and preserves command order'

: > "$TEST_LOG"
if TEST_FAIL_RUSTUP=1 run_build; then
  echo 'FAIL: toolchain error was ignored' >&2; exit 1
fi
! grep -q '^npm ' "$TEST_LOG"
echo 'PASS: toolchain failure stops before npm'

mv "$TEST_PROJECT/.tools/cargo/bin/rustup" "$fixture_root/saved-rustup"
: > "$TEST_LOG"
if TEST_FAIL_DOWNLOAD=1 run_build; then
  echo 'FAIL: download error was ignored' >&2; exit 1
fi
[[ "$(cat "$TEST_LOG")" == bootstrap ]]
echo 'PASS: bootstrap download failure stops the build'
