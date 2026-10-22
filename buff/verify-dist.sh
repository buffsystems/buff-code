#!/usr/bin/env bash
# Проверка выпуска: каждая цель на месте, у каждой — бинарь, а тот, что подходит
# этой машине, отвечает на --version ровно той версией, которую мы собирали.
set -euo pipefail
DIST="${1:?dist dir}"; BINARY="${2:?binary name}"; VERSION="${3:?version}"
EXPECTED_TARGETS=(
  cli-linux-arm64 cli-linux-x64 cli-linux-x64-baseline
  cli-linux-arm64-musl cli-linux-x64-musl cli-linux-x64-baseline-musl
  cli-darwin-arm64 cli-darwin-x64 cli-darwin-x64-baseline
  cli-windows-arm64 cli-windows-x64 cli-windows-x64-baseline
)
fail=0
for t in "${EXPECTED_TARGETS[@]}"; do
  bin="$DIST/$t/bin/$BINARY"; [ "${t#cli-windows}" != "$t" ] && bin="$bin.exe"
  if [ ! -f "$bin" ]; then echo "ОТСУТСТВУЕТ: $t → $bin"; fail=1; continue; fi
  rg="$(dirname "$bin")/buff-rg"; [ "${t#cli-windows}" != "$t" ] && rg="$rg.exe"
  if [ ! -f "$rg" ]; then echo "НЕТ ripgrep: $t → $rg"; fail=1; continue; fi
  git="$(dirname "$bin")/buff-git/libexec/git-core/git"; [ "${t#cli-windows}" != "$t" ] && git="$(dirname "$bin")/buff-git/cmd/git.exe"
  if [ "${t#cli-darwin}" = "$t" ] && [ ! -f "$git" ]; then echo "НЕТ встроенного git: $t → $git"; fail=1; continue; fi
  printf '%-28s %10s байт  %s\n' "$t" "$(stat -c%s "$bin")" "$(sha256sum "$bin" | cut -c1-16)"
done
native="$DIST/cli-linux-x64/bin/$BINARY"
if [ -x "$native" ]; then
  got="$("$native" --version 2>&1 | tr -d '\r')"
  echo "--version на этой машине: $got"
  [[ "$got" == *"$VERSION"* ]] || { echo "ОЖИДАЛАСЬ версия $VERSION"; fail=1; }
  "$DIST/cli-linux-x64/bin/buff-rg" --version | head -1 || { echo "ripgrep сборки не запускается"; fail=1; }
  "$DIST/cli-linux-x64/bin/buff-git/libexec/git-core/git" --version || { echo "встроенный git не запускается"; fail=1; }
fi
exit $fail
