# Сборка Buff Code. Всё выполняется в контейнере: на хосте нужен только docker.
# ВАЖНО: пути, которые уходят внутрь контейнера, — контейнерные (/src/...), а не хостовые,
# иначе сборка пишет артефакты внутрь контейнера и они исчезают вместе с ним.
SHELL := /bin/bash
ROOT  := $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/..)
IMAGE := buff-code-build:local
BRAND := $(ROOT)/buff/brand.json
BINARY := $(shell python3 -c "import json;print(json.load(open('$(BRAND)'))['binary'])")
# Версия — из brand.json, чтобы консоль и десктоп никогда не разъезжались: сквозная версия выпуска,
# которую туда пишет выпуск (#848); до неё — прежняя `<апстрим>-buff.<N>`.
VERSION ?= $(shell python3 -c "import json;b=json.load(open('$(BRAND)'));print(b.get('version') or b['upstream']['tag'].lstrip('v')+'-buff.'+str(b.get('release',1)))")
DIST_HOST := $(ROOT)/buff/dist
DIST := /src/buff/dist
DOCKER_RUN := docker run --rm -v $(ROOT):/src -w /src \
	-e OPENCODE_VERSION=$(VERSION) -e OPENCODE_CHANNEL=latest -e HOME=/tmp $(IMAGE)

.PHONY: icons image deps dist dist-one verify shots test unit package desktop desktop-bundle desktop-linux desktop-win desktop-mac desktop-mac-arm64 desktop-mac-x64 desktop-shot shell clean
icons:                      ## мобильные и веб-иконки десктопа под нашим знаком (ios/, android/)
	docker run --rm -v $(ROOT):/src -w /src -e HOME=/tmp $(IMAGE) sh -c 'git config --global --add safe.directory /src && buff/icons.sh'

image:                      ## собрать образ сборки
	docker build -t $(IMAGE) -f $(ROOT)/buff/Dockerfile $(ROOT)/buff

# Закрытая дизайн-система @buff/ui ставится из GitLab по ветке (#764): учётка — файлом хранилища git
# GIT_CREDENTIALS (как его кладёт CI deploy), на время установки и только на чтение; не задан — без неё.
GIT_CREDS_ENV = $(if $(GIT_CREDENTIALS),-v $(GIT_CREDENTIALS):/tmp/.git-credentials:ro -e GIT_CONFIG_COUNT=1 \
	-e GIT_CONFIG_KEY_0=credential.helper -e "GIT_CONFIG_VALUE_0=store --file=/tmp/.git-credentials")

deps:                       ## поставить зависимости монорепозитория
	docker run --rm -v $(ROOT):/src -w /src -e HOME=/tmp $(GIT_CREDS_ENV) $(IMAGE) bun install --frozen-lockfile

dist:                       ## собрать бинарь под все цели
	$(DOCKER_RUN) bash -c 'cd packages/cli && bun run script/build.ts --outdir=$(DIST)'

dist-one:                   ## собрать бинарь под одну цель (или несколько через запятую — сборка стирает dist): make dist-one TARGET=buff-linux-x64-baseline (флот стенда из ветки)
	@test -n "$(TARGET)" || { echo "TARGET не задан" >&2; exit 1; }
	$(DOCKER_RUN) bash -c 'cd packages/cli && bun run script/build.ts --outdir=$(DIST) --target=$(TARGET)'

verify:                     ## проверить артефакты и ответ --version
	$(DOCKER_RUN) bash buff/verify-dist.sh $(DIST) $(BINARY) $(VERSION)

shots:                      ## снимки терминального интерфейса
	$(DOCKER_RUN) bash buff/shots/shoot.sh $(DIST) $(BINARY)

# Сборка десктопа под чужую систему: цель задаётся OPENCODE_CLI_TARGET, потому что внутрь
# пакета кладётся консольный бинарь именно для неё. Перед каждой целью старый бинарь убираем,
# иначе в пакет уедет пара «свой + чужой» и он растолстеет вдвое.
# Подпись и нотаризация macOS (#764): ключи — переменными окружения по имени (значения в команду не
# попадают); не заданы — ad-hoc подпись (packages/desktop/scripts/mac-sign.ts).
MAC_SIGN_ENV := -e BUFF_MAC_SIGN_P12 -e BUFF_MAC_SIGN_PASSWORD -e BUFF_MAC_NOTARY_ISSUER -e BUFF_MAC_NOTARY_KEY_ID -e BUFF_MAC_NOTARY_KEY

DESKTOP_RUN = docker run --rm -v $(ROOT):/src -w /src/packages/desktop -e HOME=/tmp \
	-e OPENCODE_CHANNEL=prod -e OPENCODE_VERSION=$(VERSION) -e OPENCODE_CLI_DIST=$(DIST) \
	-e BUFF_BINARY=$(BINARY) -e WINEDEBUG=-all -e OPENCODE_CLI_TARGET=$(1) $(MAC_SIGN_ENV) $(IMAGE) \
	bash -c 'rm -f resources/buff resources/buff.exe && bun run prebuild && $(2)'

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
desktop-mac: desktop-mac-arm64 desktop-mac-x64 ## десктоп под macOS (zip ×2; с ключами BUFF_MAC_* — Developer ID и нотаризация, без них — ad-hoc)

desktop-mac-arm64: desktop-bundle ## десктоп под macOS на Apple Silicon (zip)
	$(call DESKTOP_RUN,aarch64-apple-darwin,$(EB) --mac zip --arm64 && cp dist/latest-mac.yml dist/latest-mac-arm64.yml)

desktop-mac-x64: desktop-bundle ## десктоп под macOS на Intel (zip)
	$(call DESKTOP_RUN,x86_64-apple-darwin,$(EB) --mac zip --x64 && cp dist/latest-mac.yml dist/latest-mac-x64.yml)

desktop: desktop-linux desktop-win desktop-mac ## десктоп под все три системы

test:                       ## сторожа: бренд (наши адреса, каталоги, срезанное чужое), переводы (#472) и язык установщика (#713)
	docker run --rm -v $(ROOT):/src -w /src/buff -e HOME=/tmp $(IMAGE) bun test test/brand.test.ts test/i18n.test.ts test/install.test.ts

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
