#!/usr/bin/env bash
# Снимок десктопного приложения: настоящее окно Electron в Xvfb.
# --no-sandbox обязателен в контейнере (нет SUID у chrome-sandbox), --disable-gpu — нет видеокарты.
# Оконный менеджер обязателен: без него окно не получает фокус, а заставка ждёт именно его
# (см. splash.tsx: отрисовка стартует по focus/visibilitychange) и приложение «залипает» на логотипе.
set -euo pipefail
APP="${1:?путь к распакованному приложению}"
NAME="${2:-buff-desktop}"
DELAY="${3:-40}"
OUT="$(dirname "$0")/out"; mkdir -p "$OUT"
export DISPLAY=:99 LANG=C.UTF-8 LC_ALL=C.UTF-8
export XDG_CONFIG_HOME=/tmp/dh/config XDG_DATA_HOME=/tmp/dh/data XDG_STATE_HOME=/tmp/dh/state XDG_CACHE_HOME=/tmp/dh/cache
rm -rf /tmp/dh; mkdir -p /tmp/dh
Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 & XVFB=$!
sleep 2
openbox >/tmp/openbox.log 2>&1 & WM=$!
sleep 1
"$APP" --no-sandbox --disable-gpu --disable-dev-shm-usage >/tmp/desktop.log 2>&1 & APPPID=$!
for i in $(seq 1 20); do
  sleep 1
  WIN=$(xdotool search --onlyvisible --name "." 2>/dev/null | tail -1 || true)
  [ -n "${WIN:-}" ] && { xdotool windowactivate "$WIN" 2>/dev/null || true; xdotool windowfocus "$WIN" 2>/dev/null || true; break; }
done
sleep "$DELAY"
WIN=$(xdotool search --onlyvisible --name "." 2>/dev/null | tail -1 || true)
[ -n "${WIN:-}" ] && { xdotool windowactivate "$WIN" 2>/dev/null || true; }
import -window root "$OUT/$NAME.png"
echo "снимок: $OUT/$NAME.png ($(stat -c%s "$OUT/$NAME.png") байт)"
echo "--- журнал приложения ---"; grep -v "dbus\|Fontconfig" /tmp/desktop.log | tail -12 || true
kill $APPPID $WM $XVFB 2>/dev/null || true
wait 2>/dev/null || true
