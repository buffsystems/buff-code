# Сборка Buff Code. Всё выполняется в контейнере: на хосте нужен только docker.
# ВАЖНО: пути, которые уходят внутрь контейнера, — контейнерные (/src/...), а не хостовые,
# иначе сборка пишет артефакты внутрь контейнера и они исчезают вместе с ним.
SHELL := /bin/bash
ROOT  := $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/..)
IMAGE := buff-code-build:local
BRAND := $(ROOT)/buff/brand.json
BINARY := $(shell python3 -c "import json;print(json.load(open('$(BRAND)'))['binary'])")
UPSTREAM_TAG := $(shell python3 -c "import json;print(json.load(open('$(BRAND)'))['upstream']['tag'])")
# Номер нашего выпуска — из brand.json, чтобы консоль и десктоп никогда не разъезжались.
BUFF_RELEASE ?= $(shell python3 -c "import json;print(json.load(open('$(BRAND)')).get('release',1))")
VERSION ?= $(UPSTREAM_TAG:v%=%)-buff.$(BUFF_RELEASE)
DIST_HOST := $(ROOT)/buff/dist
DIST := /src/buff/dist
DOCKER_RUN := docker run --rm -v $(ROOT):/src -w /src \
	-e OPENCODE_VERSION=$(VERSION) -e OPENCODE_CHANNEL=latest -e HOME=/tmp $(IMAGE)

.PHONY: icons image deps dist verify shots test unit package desktop desktop-bundle desktop-linux desktop-win desktop-mac desktop-shot shell clean
icons:                      ## мобильные и веб-иконки десктопа под нашим знаком (ios/, android/)
	docker run --rm -v $(ROOT):/src -w /src -e HOME=/tmp $(IMAGE) sh -c 'git config --global --add safe.directory /src && buff/icons.sh'

image:                      ## собрать образ сборки
	docker build -t $(IMAGE) -f $(ROOT)/buff/Dockerfile $(ROOT)/buff

deps:                       ## поставить зависимости монорепозитория
	docker run --rm -v $(ROOT):/src -w /src -e HOME=/tmp $(IMAGE) bun install --frozen-lockfile

dist:                       ## собрать бинарь под все цели
	$(DOCKER_RUN) bash -c 'cd packages/cli && bun run script/build.ts --outdir=$(DIST)'

verify:                     ## проверить артефакты и ответ --version
	$(DOCKER_RUN) bash buff/verify-dist.sh $(DIST) $(BINARY) $(VERSION)

shots:                      ## снимки терминального интерфейса
	$(DOCKER_RUN) bash buff/shots/shoot.sh $(DIST) $(BINARY)

# Сборка десктопа под чужую систему: цель задаётся OPENCODE_CLI_TARGET, потому что внутрь
# пакета кладётся консольный бинарь именно для неё. Перед каждой целью старый бинарь убираем,
# иначе в пакет уедет пара «свой + чужой» и он растолстеет вдвое.
DESKTOP_RUN = docker run --rm -v $(ROOT):/src -w /src/packages/desktop -e HOME=/tmp \
	-e OPENCODE_CHANNEL=prod -e OPENCODE_VERSION=$(VERSION) -e OPENCODE_CLI_DIST=$(DIST) \
	-e BUFF_BINARY=$(BINARY) -e WINEDEBUG=-all -e OPENCODE_CLI_TARGET=$(1) $(IMAGE) \
	bash -c 'rm -f resources/opencode-cli resources/opencode-cli.exe && bun run prebuild && $(2)'

EB := bunx electron-builder --config electron-builder.config.ts -c.extraMetadata.version=$(VERSION)

desktop-bundle:             ## собрать бандлы приложения (общие для всех систем)
	docker run --rm -v $(ROOT):/src -w /src/packages/desktop -e HOME=/tmp \
		-e OPENCODE_CHANNEL=prod -e OPENCODE_VERSION=$(VERSION) -e OPENCODE_CLI_DIST=$(DIST) \
		-e BUFF_BINARY=$(BINARY) $(IMAGE) bun run build

desktop-linux: desktop-bundle ## десктоп под Linux (AppImage + deb + rpm)
	$(call DESKTOP_RUN,x86_64-unknown-linux-gnu,$(EB) --linux)

desktop-win: desktop-bundle ## десктоп под Windows (установщик NSIS, собирается через wine)
	$(call DESKTOP_RUN,x86_64-pc-windows-msvc,$(EB) --win)

# Архитектуры собираются ПООЧЕРЁДНО (в каждый пакет кладётся свой консольный бинарь),
# поэтому файл обновления второй затирает первый — сохраняем оба, package.sh их сольёт.
desktop-mac: desktop-bundle ## десктоп под macOS (zip ×2, ad-hoc подпись rcodesign)
	$(call DESKTOP_RUN,aarch64-apple-darwin,$(EB) --mac zip --arm64 && cp dist/latest-mac.yml dist/latest-mac-arm64.yml)
	$(call DESKTOP_RUN,x86_64-apple-darwin,$(EB) --mac zip --x64 && cp dist/latest-mac.yml dist/latest-mac-x64.yml)

desktop: desktop-linux desktop-win desktop-mac ## десктоп под все три системы

test:                       ## сторожа: бренд (наши адреса, каталоги, срезанное чужое) и переводы (#472)
	docker run --rm -v $(ROOT):/src -w /src/buff -e HOME=/tmp $(IMAGE) bun test test/brand.test.ts test/i18n.test.ts

unit:                       ## тесты пакетов в окружении CI: make unit [PKG="core tui"] (без PKG — все)
	IMAGE=$(IMAGE) bash $(ROOT)/buff/unit.sh $(PKG)

package:                    ## собрать выпуск: архивы, пакеты, суммы, ответы обновлений
	$(DOCKER_RUN) bash buff/package.sh /src $(VERSION) $(BINARY)

desktop-shot:               ## снимок десктопного окна
	$(DOCKER_RUN) bash buff/shots/shoot-desktop.sh \
		/src/packages/desktop/dist/linux-unpacked/systems.buff.code buff-desktop 45

shell:                      ## оболочка внутри образа сборки
	docker run --rm -it -v $(ROOT):/src -w /src -e HOME=/tmp $(IMAGE) bash

clean:
	rm -rf $(DIST_HOST)

# Наша публикация и канал обновлений — рядом, вне публичных исходников (#624).
-include ops.mk
