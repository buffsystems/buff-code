// Сторож бренда. Его задача — падать после подъёма апстрима, если наши правки
// откатились и продукт снова зовёт чужие адреса или пишет в чужие каталоги.
import { test, expect } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const brand = JSON.parse(read("buff/brand.json"))

test("бренд описан целиком", () => {
  for (const key of ["product", "binary", "appDir", "bundleId", "scheme", "updateApi", "installScript", "release"])
    expect(brand[key]).toBeDefined()
  expect(brand.binary).toBe("buff")
  expect(brand.bundleId).toBe("systems.buff.code")
})

test("консоль обновляется из НАШЕГО канала", () => {
  const updater = read("packages/cli/src/services/updater.ts")
  // Консоль, поставленная нашим скриптом (~/.buff/bin/buff), узнаётся как «поставлена
  // скриптом» — иначе buff upgrade не знает, как обновляться (#377).
  expect(updater).toContain("BUFF_BINARY")
  expect(updater).not.toContain('".opencode",\n      "bin"')
  expect(updater).not.toContain("opencode.ai")
  expect(updater).toContain("BUFF_UPDATE_API")
  expect(updater).toContain("BUFF_INSTALL_SCRIPT")
})

test("состояние лежит в нашем каталоге", () => {
  expect(read("packages/util/src/global.ts")).toContain("BUFF_APP_DIR")
  // Клиент ищет файл регистрации службы там же, где её пишет консоль, иначе десктоп
  // не найдёт свою службу и будет бесконечно поднимать новые.
  for (const file of ["packages/client/src/effect/service.ts", "packages/client/src/promise/service.ts"]) {
    const src = read(file)
    expect(src).toContain("BUFF_APP_DIR")
    expect(src).not.toContain('"opencode", "service.json"')
  }
  // Изолированная локальная служба `bun dev:desktop` — тот же файл, иначе тот же бесконечный цикл.
  // Имя каталога у десктопа одно — для регистрации службы и для экспорта её логов (#596).
  expect(read("packages/desktop/src/main/buff/server-logs.ts")).toContain("BUFF_APP_DIR")
  const desktop = read("packages/desktop/src/main/service/background-service.ts")
  expect(desktop).toContain('import { appDir } from "../buff/server-logs"')
  expect(desktop).not.toContain('"opencode", "service-local.json"')
})

test("свои провайдеры — как у апстрима, каталог моделей — из вшитого снимка (#562)", () => {
  const internal = read("packages/core/src/plugin/internal.ts")
  expect(internal).toContain("  ...ProviderPlugins,")
  expect(internal).toContain("plugins.filter(BuffBrand.keepPlugin)")
  expect(read("packages/core/src/models-dev.ts")).toContain("OFFLINE_MODEL_CATALOG")
})

test("macOS-пакет подписан ad-hoc без hardened runtime — иначе dyld не грузит Electron Framework (#377)", () => {
  const config = read("packages/desktop/electron-builder.config.ts")
  expect(config).toContain('execFileAsync("rcodesign", ["sign", bundle])')
  expect(config).not.toContain('"--code-signature-flags", "runtime"')
})

test("десктоп собирается под нашим именем", () => {
  const config = read("packages/desktop/electron-builder.config.ts")
  expect(config).toContain("systems.buff.code")
  expect(config).toContain('productName: "Buff Code"')
  expect(config).toContain(brand.updateApi)
  expect(config).not.toContain("ai.opencode.desktop")
  // macOS мы собираем на Linux, где подпись пропускается: без своей она не появится.
  expect(config).toContain("rcodesign")
  expect(read("packages/desktop/src/renderer/index.html")).toContain("<title>Buff Code</title>")
})

test("вход разработчика через коннектор компании на месте (#366)", () => {
  const internal = read("packages/core/src/plugin/internal.ts")
  expect(internal).toContain("BuffLogin.Plugin")
  const login = read("packages/core/src/buff/login.ts")
  // Все три шага идут через шлюз коннектора, а не напрямую в облако.
  for (const path of ["/v1/developer/device/start", "/v1/developer/device/poll", "/v1/developer/refresh"])
    expect(login).toContain(path)
  // Подпись обновления — байт в байт как developerPopMessage на бэкенде.
  expect(login).toContain("developer-refresh:${deviceID}:${jti}")
})

test("иконки для веб-интерфейса есть во всех каналах — иначе сборка из чистого клона падает", () => {
  // packages/app/vite.icons.ts читает их при каждой сборке; канал latest берёт dev.
  for (const channel of ["prod", "beta", "dev"])
    for (const file of ["icon.ico", "icon.png", "ios/AppIcon-60x60@3x.png", "android/mipmap-xxxhdpi/ic_launcher.png"])
      expect(existsSync(join(root, "packages/desktop/icons", channel, file))).toBe(true)
})

test("рабочий контекст за каталогом на месте (#391)", () => {
  expect(read("packages/core/src/plugin/internal.ts")).toContain("BuffWorkContext.Plugin")
  const ctx = read("packages/core/src/buff/context.ts")
  expect(ctx).toContain("/v1/developer/workspace")
  expect(read("packages/schema/src/buff-context.ts")).toContain('id: "buff.context"')
})

test("контекст виден и меняется в терминальном интерфейсе (#391)", () => {
  expect(read("packages/tui/src/plugin/builtins.ts")).toContain("BuffContext")
  const tui = read("packages/tui/src/feature-plugins/buff/context.tsx")
  expect(tui).toContain("slash: { name: step }")
  for (const step of ['command("org"', 'command("project"', 'command("space"']) expect(tui).toContain(step)
  // Слой команд — в компоненте приложения, иначе «Keymap.Provider is missing» и плагин молча не работает.
  expect(tui).toContain('append: "app"')
  expect(tui).toContain('"prompt.footer.status"')
})

test("контекст виден и меняется в десктопе (#391)", () => {
  for (const file of ["packages/app/src/new-session/view.tsx", "packages/app/src/session/composer/region.tsx"])
    expect(read(file)).toContain("<BuffContextChip />")
  expect(read("packages/app/src/buff/context-chip.tsx")).toContain("chooseProject")
})

test("имя продукта в переводах десктопа подставляется при загрузке (#398)", () => {
  const language = read("packages/app/src/runtime/i18n/language.tsx")
  expect(language).toContain("brandDictionary(flatten({ ...en, ...dict }))")
  expect(language).toContain("brandDictionary(flatten({ ...a.dict, ...b.dict }))")
  expect(read("packages/app/src/runtime/i18n/desktop-native.ts")).toContain("DESKTOP_NATIVE_ENGLISH = brandDictionary(")
})

test("на экранах десктопа нет чужого имени (#398)", () => {
  // Меню приложения, имя темы по умолчанию, экран подключения, заголовок веб-приложения.
  expect(read("packages/app/src/shell/titlebar/windows-menu.tsx")).not.toContain(">OpenCode<")
  expect(read("packages/ui/src/theme/context.tsx")).not.toContain('"oc-2": "OpenCode"')
  expect(read("packages/app/src/servers/connect/screen.tsx")).not.toContain('aria-label="OpenCode"')
  expect(read("packages/ui/src/components/favicon.tsx")).not.toContain('content="OpenCode"')
})

test("buff models ждёт модели Buff под индикатором (#399)", () => {
  const models = read("packages/cli/src/commands/handlers/models.ts")
  // rpc ждёт активации плагинов, список моделей — нет: сначала контекст, потом список.
  expect(models).toContain("setupBuff")
  expect(read("packages/cli/src/commands/handlers/buff/setup.ts")).toContain("BuffContext.Rpc")
})

test("настройка при запуске, без отдельных команд (#401)", () => {
  const commands = read("packages/cli/src/commands/commands.ts")
  for (const gone of ['Spec.make("org"', 'Spec.make("project"', 'Spec.make("space"'])
    expect(commands).not.toContain(gone)
  // Вход в провайдера командой — как у апстрима (#562); редактор зовёт её же.
  expect(commands).toContain('"log in to a provider"')
  expect(read("packages/cli/src/commands/handlers/run.ts")).toContain("setupBuff")
  expect(read("packages/cli/src/acp/service.ts")).toContain('args: ["auth", "login"]')
  expect(read("packages/tui/src/feature-plugins/buff/context.tsx")).toContain('integrationID="buff"')
  expect(read("packages/app/src/buff/sign-in.tsx")).toContain('controller.select("buff")')
  expect(read("packages/app/src/buff/context-chip.tsx")).toContain("openBuffSignIn")
})

test("инструменты пространства прописаны сами после входа (#368)", () => {
  const tools = read("packages/core/src/buff/tools.ts")
  expect(tools).toContain("/v1/mcp")
  expect(tools).toContain("oauth: false")
  expect(read("packages/core/src/buff/context.ts")).toContain("BuffTools.register(ctx, signedIn, saved)")
})

test("заголовок окна терминала — «Buff», а не «OC» (#398)", () => {
  for (const file of ["packages/tui/src/app.tsx", "packages/tui/src/mini/runtime.lifecycle.ts"]) {
    expect(read(file)).not.toContain("setTerminalTitle(`OC | ")
    expect(read(file)).toContain("setTerminalTitle(`Buff | ")
  }
})

test("на пути входа в Buff не осталось прежних английских строк апстрима (#377, #472)", () => {
  // Вход в Buff рисует общий диалог апстрима; его строки на этом пути заменены своими, и
  // они идут через перевод (#472, сторож — buff/test/i18n.test.ts), а не английским текстом.
  const where: Record<string, string[]> = {
    "packages/tui/src/component/dialog-integration.tsx": ["Waiting for authorization", ">open<", ">copy<", "Authorization code"],
    "packages/tui/src/context/local.tsx": ["Connect a provider", "No provider selected"],
    "packages/cli/src/commands/handlers/auth/login.ts": ["Waiting for authorization", "Authentication failed", "Connected to "],
    "packages/cli/src/ui/prompt.ts": ['outro("Failed")', 'cancel("Cancelled")'],
  }
  for (const [file, strings] of Object.entries(where)) {
    const src = read(file)
    for (const s of strings) expect(src, `${file}: «${s}»`).not.toContain(s)
  }
})

test("база знаний организации — свой MCP с прямыми инструментами knowledge_* (#371)", () => {
  const tools = read("packages/core/src/buff/tools.ts")
  expect(tools).toContain('knowledgeServerName = "knowledge"')
  expect(tools).toContain("/v1/knowledge/mcp")
  expect(tools).toContain("codemode: false")
  // Форма MCP несёт Location, иначе интерфейс её не показывает и запись нельзя подтвердить.
  expect(read("packages/core/src/mcp/index.ts")).toContain("Effect.provideService(Location.Service, location)")
})

test("репозитории проекта — свой MCP только для чтения, прямые инструменты repos_* (#372)", () => {
  const tools = read("packages/core/src/buff/tools.ts")
  expect(tools).toContain('reposServerName = "repos"')
  expect(tools).toContain("/v1/repos/mcp")
})

test("наши команды контекста не перекрыты апстримными псевдонимами", () => {
  // /org, /project и /space — команды рабочего контекста Buff (#401). У апстримной /open был
  // псевдоним «project»: по Enter открывался чужой диалог вместо выбора проекта (#413).
  const app = read("packages/tui/src/app.tsx")
  const claimed = new Set<string>()
  for (const m of app.matchAll(/slash:\s*\{\s*name:\s*"([^"]+)"(?:,\s*aliases:\s*\[([^\]]*)\])?/g)) {
    claimed.add(m[1])
    for (const alias of (m[2] ?? "").matchAll(/"([^"]+)"/g)) claimed.add(alias[1])
  }
  for (const ours of ["org", "project", "space"]) expect(claimed.has(ours), `/${ours} занята апстримом`).toBe(false)
})

test("риска карты запросов не заливается квадратом (#470)", () => {
  // Отступ риски — зона для курсора, закрашено только содержимое (background-clip: content-box).
  // Сокращённое `background:` в состоянии сбрасывает background-clip — риска становится квадратом.
  const css = readFileSync(join(import.meta.dir, "..", "..", "packages/app/src/buff/query-map.css"), "utf8")
  expect(css).toContain("background-clip: content-box")
  expect(css).not.toMatch(/^\s*background:/m)
})

test("пользователь не читает «OpenCode» как имя нашего продукта (#596, #628)", async () => {
  // Сообщения об ошибках, текст окна, консоли и терминального интерфейса называют продукт
  // Buff Code. Имя апстрима остаётся только там, где речь о нём самом или его сервисах, и там,
  // где это идентификатор, который человек не читает.
  const { brandStrings } = await import("./brand-scan")
  const allowed: { path: RegExp; text: RegExp; reason: string }[] = [
    {
      path: /^packages\/(app\/src\/buff\/about-content|schema\/src\/buff-i18n\/ru-account)\.ts$/,
      text: /Based on OpenCode|Основан на OpenCode|OpenCode ©|OpenCode is a registered trademark|OpenCode — зарегистрированный/,
      reason: "указание на апстрим и его товарный знак — по лицензии",
    },
    {
      path: /^packages\/(session-ui\/src\/(components\/markdown(\.worker)?|pierre\/(worker|index))|ui\/src\/context\/marked(-theme|-theme-register)?|app-react\/src\/session\/timeline\/markdown\/markdown-view)\.tsx?$/,
      text: /^(shiki )?OpenCode$/,
      reason: "имя темы подсветки кода — идентификатор, на экран не выводится",
    },
    {
      path: /^packages\/(session-ui\/src\/tools\/tool-renderer\.tsx|app-react\/src\/session\/timeline\/tools\/info\.ts|core\/src\/plugin\/provider\/opencode\.ts)$/,
      text: /OpenCode/,
      reason: "облачный сервис апстрима (OpenCode Zen/Console) — имя провайдера, как Anthropic или OpenAI",
    },
    {
      path: /^packages\/core\/src\/plugin\/skill\.ts$/,
      text: /OpenCode|opencode/,
      reason: "встроенные навыки апстрима о нём самом — в Buff Code вырезаны (UPSTREAM_CUT, #445)",
    },
    {
      path: /^packages\/(desktop\/src\/main\/browser\/network\.ts|plugin-browser\/src\/proxy\.ts)$/,
      text: /realm="?OpenCode Browser Proxy|^OpenCode Browser Proxy$/,
      reason: "realm внутреннего прокси браузера: окно отвечает на него само, человек его не видит",
    },
    {
      path: /^packages\/cli\/src\/commands\/handlers\/uninstall\.ts$/,
      text: /^# opencode$/,
      reason: "метка, которую установщик апстрима оставил в профиле оболочки, — по ней её убирают",
    },
    {
      path: /^packages\/tui\/src\/mini\/demo\.ts$/,
      text: /"name": "opencode"/,
      reason: "содержимое демонстрационного файла package.json",
    },
  ]
  const found = brandStrings()
  const leaks = found
    .filter((hit) => !allowed.some((rule) => rule.path.test(hit.path) && rule.text.test(hit.text)))
    .map((hit) => `${hit.path}:${hit.line}: «${hit.text}»`)
  expect(leaks).toEqual([])
  // Исключение без находки устарело — его убирают, чтобы список не прикрывал будущие строки.
  const stale = allowed.filter((rule) => !found.some((hit) => rule.path.test(hit.path) && rule.text.test(hit.text)))
  expect(stale.map((rule) => rule.reason)).toEqual([])
})
