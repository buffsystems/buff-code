#!/usr/bin/env bash
# Мобильные и веб-иконки десктопа (ios/, android/) под нашим знаком — для всех каналов.
# Веб-интерфейс берёт отсюда apple-touch-icon и иконки манифеста, поэтому без них сборка
# падает. Имена и размеры — ровно как у апстрима (снимок UPSTREAM), картинка — наша:
# buff/assets/icon-1024.png, а слой переднего плана адаптивной иконки Android — mark-512.png.
# XML адаптивной иконки берётся из апстрима как есть.
set -euo pipefail
cd "$(dirname "$0")/.."
UPSTREAM=${UPSTREAM:-$(python3 -c "import json;print(json.load(open('buff/brand.json'))['upstream']['commit'])" 2>/dev/null || true)}
: "${UPSTREAM:?задайте UPSTREAM=<коммит апстрима с исходными иконками>}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
for channel in prod beta dev; do
  git ls-tree -r --name-only "$UPSTREAM" "packages/desktop/icons/$channel" | grep -E "/(ios|android)/" | while read -r path; do
    mkdir -p "$(dirname "$path")"
    case "$path" in
      *.xml) git show "$UPSTREAM:$path" > "$path" ;;
      *.png)
        git show "$UPSTREAM:$path" > "$tmp/src.png"
        size=$(identify -format "%wx%h" "$tmp/src.png")
        src=buff/assets/icon-1024.png
        [[ "$path" == *_foreground.png ]] && src=buff/assets/mark-512.png
        convert "$src" -background none -resize "$size" -gravity center -extent "$size" "$path"
        ;;
    esac
  done
done
echo "иконки ios/android пересобраны из $UPSTREAM"
