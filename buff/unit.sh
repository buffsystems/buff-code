#!/usr/bin/env bash
# Тесты пакетов Buff Code в окружении, где они проходят целиком — как у пользователя и в CI:
#   buff/unit.sh [пакет…]   (без пакетов — все, у которых есть сценарий test или каталог test)
# Что задаёт окружение и почему:
#  - без обхода прав файлов (root в контейнере игнорирует chmod — тесты прав врут);
#  - init — убирает осиротевшие процессы (иначе «убитый» потомок жив как зомби);
#  - виртуальный дисплей с оконным менеджером — окна Electron и перетаскивание X11;
#  - Electron без песочницы root и без GPU (рисует программно), общая память побольше;
#  - локаль UTF-8 — пути с не-ASCII именами; HOME не во /tmp — пути /tmp не сокращаются до ~.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-buff-code-build:local}"
cd "$ROOT/packages"
packages=("$@")
if [ ${#packages[@]} -eq 0 ]; then
  for dir in */; do
    { grep -q '"test":' "$dir/package.json" 2>/dev/null || [ -d "$dir/test" ]; } && packages+=("${dir%/}")
  done
fi
failed=()
for pkg in "${packages[@]}"; do
  echo "== $pkg"
  # Свой сценарий test (у core — изоляция HOME); без него — тесты пакета напрямую.
  run="bun test"; grep -q '"test":' "$pkg/package.json" && run="bun run test"
  docker run --rm --init --shm-size=1g --cap-drop DAC_OVERRIDE --cap-drop DAC_READ_SEARCH \
    -e LANG=C.UTF-8 -e HOME=/root -e ELECTRON_DISABLE_SANDBOX=1 -e BUFF_TEST_NO_GPU=1 \
    -v "$ROOT:/src" -w "/src/packages/$pkg" "$IMAGE" \
    xvfb-run -a -s "-screen 0 1920x1080x24" sh -c "openbox >/dev/null 2>&1 & $run" || failed+=("$pkg")
done
if [ ${#failed[@]} -gt 0 ]; then echo "НЕ ПРОШЛИ: ${failed[*]}"; exit 1; fi
echo "ВСЕ ПРОШЛИ: ${packages[*]}"
