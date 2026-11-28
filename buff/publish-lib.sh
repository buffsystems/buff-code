# Заливка одного файла выпуска в реестр (publish.sh, проверяет buff/test/publish.test.ts).
# Нужны VERSION, REGISTRY, REPO, ORAS_OPTS. Тег — «<версия>-<файл>».
#
# Лежащий в реестре ТЕМИ ЖЕ байтами (дайджест слоя = sha256 файла) не льётся заново: публикацию
# можно повторять. Лежащий другой сборкой — заменяется (#764): перевыпуск той же версии
# (исправления в рамках выпуска) иначе оставлял на зеркале файлы и суммы первой сборки.

# Дайджест единственного слоя манифеста OCI-артефакта; пусто — не разобрать.
layer_digest() {
  sed -n 's/.*"layers":\[{[^}]*"digest":"\([^"]*\)".*/\1/p' | head -1
}

push_one() {
  local file="$1" tag want have
  tag="$(printf '%s' "$VERSION-$file" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9._-' '-')"
  want="sha256:$(sha256sum "$file" | cut -d' ' -f1)"
  have="$(oras manifest fetch $ORAS_OPTS "$REGISTRY/$REPO:$tag" 2>/dev/null | layer_digest || true)"
  if [ "$have" = "$want" ]; then
    echo "  $file — уже в реестре"
    return 0
  fi
  [ -z "$have" ] || echo "  $file — в реестре другая сборка, заменяю"
  for attempt in $(seq 1 "${PUBLISH_ATTEMPTS:-40}"); do
    # Обрыв посреди заливки оставляет соединение висеть без конца — попытка ограничена.
    timeout "${PUBLISH_ATTEMPT_S:-1200}" oras push $ORAS_OPTS "$REGISTRY/$REPO:$tag" "$file:application/octet-stream" >/dev/null 2>&1 && {
      echo "  $file → $tag"
      return 0
    }
    [ "$attempt" -lt "${PUBLISH_ATTEMPTS:-40}" ] || { echo "  $file — не залился" >&2; return 1; }
    echo "  $file — попытка $attempt не удалась, повторю" >&2
    sleep 30
  done
}
