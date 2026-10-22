#!/usr/bin/env bash
# Статический git для Linux (#495) — встроенный git консоли и десктопа на машинах, где системный
# старее 2.35 или его нет. Собирается кросс-компиляцией `zig cc` под musl: один файл без
# зависимостей, работает и на glibc, и на musl. Только локальные команды (снимки): без curl,
# expat, perl, python, rust — сеть остаётся системному git человека.
#   build-static.sh <x64|arm64> <каталог-результата>
# Результат — <каталог>/libexec/git-core/git: git находит свой каталог программ по пути к себе
# (RUNTIME_PREFIX), поэтому вложенные вызовы `git …` идут в него же, а не в системный.
set -euo pipefail
ARCH="$1"; OUT="$2"
GIT_VERSION=2.56.0
GIT_SHA256=26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3
ZLIB_VERSION=1.3.2
ZLIB_SHA256=bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16
ZIG="${ZIG:-zig}"
case "$ARCH" in
  x64) TRIPLE=x86_64-linux-musl; MACHINE=x86_64 ;;
  arm64) TRIPLE=aarch64-linux-musl; MACHINE=aarch64 ;;
  *) echo "неизвестная архитектура: $ARCH" >&2; exit 1 ;;
esac
CACHE="${BUFF_GIT_CACHE:-$(dirname "$0")/.cache}"
BUILT="$CACHE/git-$GIT_VERSION-$ARCH"
mkdir -p "$CACHE"
install_built() {
  mkdir -p "$OUT/libexec/git-core" "$OUT/share/git-core/templates"
  install -m0755 "$BUILT" "$OUT/libexec/git-core/git"
}
# Собранный раз бинарь берётся из кэша: сборка выпуска не пересобирает git под каждую цель.
[ -f "$BUILT" ] && { install_built; exit 0; }

fetch() { # url sha256 file
  [ -f "$CACHE/$3" ] && return
  curl -fsSL -o "$CACHE/$3.part" "$1"
  echo "$2  $CACHE/$3.part" | sha256sum -c - >/dev/null || { echo "контрольная сумма $3 не сошлась" >&2; exit 1; }
  mv "$CACHE/$3.part" "$CACHE/$3"
}
fetch "https://mirrors.edge.kernel.org/pub/software/scm/git/git-$GIT_VERSION.tar.xz" "$GIT_SHA256" "git-$GIT_VERSION.tar.xz"
fetch "https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz" "$ZLIB_SHA256" "zlib-$ZLIB_VERSION.tar.gz"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
CC="$ZIG cc -target $TRIPLE"
tar -xzf "$CACHE/zlib-$ZLIB_VERSION.tar.gz" -C "$WORK"
(cd "$WORK/zlib-$ZLIB_VERSION" && CC="$CC" AR="$ZIG ar" RANLIB="$ZIG ranlib" ./configure --static --prefix="$WORK/zlib" >/dev/null && make -s -j"$(nproc)" install >/dev/null)
tar -xJf "$CACHE/git-$GIT_VERSION.tar.xz" -C "$WORK"
make -s -C "$WORK/git-$GIT_VERSION" -j"$(nproc)" git \
  CC="$CC" AR="$ZIG ar" uname_S=Linux uname_M="$MACHINE" CROSS_COMPILING=YesPlease \
  CFLAGS="-O2 -I$WORK/zlib/include" LDFLAGS="-static -s -L$WORK/zlib/lib" \
  prefix=/ gitexecdir=libexec/git-core RUNTIME_PREFIX=YesPlease \
  NO_CURL=1 NO_EXPAT=1 NO_OPENSSL=1 NO_PERL=1 NO_PYTHON=1 NO_TCLTK=1 NO_GETTEXT=1 NO_ICONV=1 NO_REGEX=NeedsStartEnd NO_RUST=1 \
  NO_INSTALL_HARDLINKS=1 >/dev/null
cp "$WORK/git-$GIT_VERSION/git" "$BUILT.part" && mv "$BUILT.part" "$BUILT"
install_built
