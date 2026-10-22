#!/usr/bin/env bash
# Сборка выпуска: раскладывает всё, что поедет к пользователю, в один каталог,
# считает контрольные суммы и пишет ответы службы обновлений.
# Артефакты берём ТОЛЬКО с диска — ничего не пересобираем, чтобы опубликованные
# байты были ровно теми, что проверены.
set -euo pipefail
ROOT="${1:?корень репозитория}"
VERSION="${2:?версия}"
BINARY="${3:-buff}"
DIST="$ROOT/buff/dist"
DESKTOP="$ROOT/packages/desktop/dist"
OUT="$ROOT/buff/release/$VERSION"

rm -rf "$OUT"; mkdir -p "$OUT"

echo "== консоль =="
for dir in "$DIST"/cli-*; do
  [ -d "$dir" ] || continue
  target="$(basename "$dir" | sed 's/^cli-//')"
  bin="$dir/bin/$BINARY"; [ -f "$bin" ] || bin="$dir/bin/$BINARY.exe"
  [ -f "$bin" ] || { echo "нет бинаря для $target"; exit 1; }
  # Рядом с бинарём — ripgrep сборки: поиск по файлам без сети.
  rg="buff-rg"; [ "${bin%.exe}" != "$bin" ] && rg="buff-rg.exe"
  [ -f "$(dirname "$bin")/$rg" ] || { echo "нет $rg для $target"; exit 1; }
  # Встроенный git (#495) — у Linux и Windows; на macOS его нет (git от Apple).
  git=(); [ -d "$(dirname "$bin")/buff-git" ] && git=(buff-git)
  tar -czf "$OUT/$BINARY-$target.tar.gz" -C "$(dirname "$bin")" "$(basename "$bin")" "$rg" "${git[@]}"
  echo "  $BINARY-$target.tar.gz"
done

echo "== десктоп =="
for f in "$DESKTOP"/*.AppImage "$DESKTOP"/*.deb "$DESKTOP"/*.rpm "$DESKTOP"/*.exe "$DESKTOP"/*.zip "$DESKTOP"/*.blockmap "$DESKTOP"/latest*.yml; do
  [ -f "$f" ] || continue
  cp "$f" "$OUT/"; echo "  $(basename "$f")"
done

python3 "$ROOT/buff/merge-mac-feed.py" "$DESKTOP" "$OUT"

echo "== установка и ответы службы обновлений =="
# Скрипт установки едет вместе с выпуском: /install на витрине отдаёт скрипт того выпуска,
# на который указывает канал, — адреса в нём и выпуск не разъедутся.
cp "$ROOT/buff/install" "$OUT/install"
# Консоль спрашивает /update/api/<канал>/cli/<способ> и ждёт версию и имя пакета; витрина
# отдаёт этот файл из выпуска, на который указывает канал.
printf '{"channel":"latest","name":"cli","distribution":"npm","version":"%s","metadata":{"package":"@buff/cli"},"active":true}\n' \
  "$VERSION" > "$OUT/update-cli-npm.json"
printf '{"channel":"latest","name":"cli","distribution":"homebrew","version":"%s","metadata":{"package":"buff"},"active":true}\n' \
  "$VERSION" > "$OUT/update-cli-homebrew.json"
# «Что нового» десктопа (#462): окно после обновления читает этот файл из канала обновлений —
# /update/api/<канал>/desktop/buff-code/changelog.json.
cp "$ROOT/buff/changelog.json" "$OUT/changelog.json"
echo "  install, update-cli-{npm,homebrew}.json, changelog.json"

echo "== контрольные суммы =="
( cd "$OUT" && sha256sum * > SHA256SUMS && echo "  SHA256SUMS: $(wc -l < SHA256SUMS) строк" )
echo
