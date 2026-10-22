#!/usr/bin/env bash
# Снимки терминального приложения: настоящий экран, а не текстовый дамп.
# Xvfb + xterm + ImageMagick — всё внутри сборочного образа, никакого железа.
set -euo pipefail
DIST="${1:?dist dir}"; BINARY="${2:?binary name}"
BIN="$DIST/cli-linux-x64/bin/$BINARY"
OUT="$(dirname "$0")/out"; mkdir -p "$OUT"
# Без UTF-8 xterm показывает рамки интерфейса кракозябрами — это не баг приложения.
export DISPLAY=:99 COLORTERM=truecolor TERM=xterm-256color LANG=C.UTF-8 LC_ALL=C.UTF-8
export XDG_CONFIG_HOME=/tmp/shot-home/config XDG_DATA_HOME=/tmp/shot-home/data \
       XDG_STATE_HOME=/tmp/shot-home/state XDG_CACHE_HOME=/tmp/shot-home/cache

shot() { # имя  ширинаxвысота  задержка  команда...
  local name="$1" geom="$2" delay="$3"; shift 3
  rm -rf /tmp/shot-home; mkdir -p /tmp/shot-home
  Xvfb :99 -screen 0 "${geom}x24" >/dev/null 2>&1 & local xvfb=$!
  sleep 1
  xterm -u8 -en UTF-8 -geometry 200x50 -fa "DejaVu Sans Mono" -fs 13 -bg "#11111b" -fg "#cdd6f4" \
        -e bash -lc "$*" >/dev/null 2>&1 & local term=$!
  sleep "$delay"
  import -window root "$OUT/$name.png"
  kill $term 2>/dev/null || true; kill $xvfb 2>/dev/null || true
  wait 2>/dev/null || true
  echo "снимок: $OUT/$name.png ($(stat -c%s "$OUT/$name.png") байт)"
}

shot buff-version 1400x600 6 "$BIN --version; echo; $BIN --help 2>&1 | head -24; sleep 60"
shot buff-tui 1600x1000 18 "$BIN; sleep 60"
