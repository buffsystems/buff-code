# Сборочный образ Buff Code: всё, чем собирается консоль и (со слайса 4) десктоп.
# Ничего проектного внутрь не печётся — исходники и артефакты приезжают бинд-маунтом.
FROM oven/bun:1.4.2-debian

RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates unzip zip xz-utils python3 make g++ ripgrep openssh-client xauth \
      xvfb xterm imagemagick fonts-dejavu-core fonts-noto-color-emoji \
      rpm fakeroot librsvg2-bin openbox xdotool x11-xserver-utils \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 \
      libasound2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxshmfence1 \
      libpango-1.0-0 libcairo2 libatspi2.0-0 \
      wine wine32 \
    && rm -rf /var/lib/apt/lists/*

# ripgrep — для тестов поиска ядра; в выпуск едет свой, вложенный сборкой (packages/cli/script/ripgrep.ts).
# openssh-client — тесты SSH-подключений десктопа (продукт берёт системный ssh); xauth — для xvfb-run.
# Node — настоящий, а не заглушка Bun: тесты загрузчика плагинов идут под Node (module.registerHooks).
ARG NODE_VERSION=24.21.0
RUN curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep "node-v${NODE_VERSION}-linux-x64.tar.xz" | sed 's|  .*|  /tmp/node.tar.xz|' | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' \
    && rm /tmp/node.tar.xz && node --version

# wine нужен electron-builder только для сборки установщика Windows (NSIS) на Linux.
# rcodesign: подпись macOS-бинарей и бандлов прямо здесь, без Mac.
ARG RCODESIGN_VERSION=0.29.0
RUN curl -fsSL -o /tmp/rc.tar.gz \
      "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    && tar xzf /tmp/rc.tar.gz -C /tmp \
    && install -m0755 "/tmp/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl/rcodesign" /usr/local/bin/rcodesign \
    && rm -rf /tmp/rc.tar.gz "/tmp/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl" \
    && rcodesign --version

# oras: заливка артефактов выпуска в наш реестр как OCI-артефактов.
ARG ORAS_VERSION=1.2.0
RUN curl -fsSL -o /tmp/oras.tar.gz \
      "https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/oras_${ORAS_VERSION}_linux_amd64.tar.gz" \
    && tar xzf /tmp/oras.tar.gz -C /usr/local/bin oras \
    && rm /tmp/oras.tar.gz \
    && oras version

# zig: кросс-компилятор C под musl — статический git для встроенного git выпуска (#495, buff/git).
ARG ZIG_VERSION=0.17.0
ARG ZIG_SHA256=1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026
RUN curl -fsSL -o /tmp/zig.tar.xz "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" \
    && echo "${ZIG_SHA256}  /tmp/zig.tar.xz" | sha256sum -c - \
    && mkdir -p /opt/zig && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && ln -s /opt/zig/zig /usr/local/bin/zig && rm /tmp/zig.tar.xz \
    && zig version

WORKDIR /src
