import { describe, expect, test } from "bun:test"
import { BuffBrand } from "../../src/buff/brand"

// #562: свои провайдеры — как у апстрима, рядом с моделями организации; облачные поиски
// апстрима по-прежнему не запускаются.
describe("какие плагины ядра запускает Buff Code у разработчика", () => {
  test("каталог моделей, провайдеры из конфига и все провайдерские плагины — да", () => {
    for (const id of [
      "opencode.models.dev",
      "opencode.config.provider",
      "opencode.provider.opencode",
      "opencode.provider.openai",
      "opencode.provider.openrouter",
      "opencode.provider.github.copilot",
      "opencode.provider.ollama",
      "opencode.provider.dynamic",
    ])
      expect(BuffBrand.kept({ id }, false)).toBe(true)
  })
  test("облачные поиски — нет", () => {
    for (const id of ["opencode.websearch.exa", "opencode.websearch.tinyfish"])
      expect(BuffBrand.kept({ id }, false)).toBe(false)
  })
  // #445: два встроенных навыка апстрима — справка по OpenCode и отчёт об ошибке в его GitHub —
  // разработчику Buff Code не предлагаются.
  test("встроенные навыки апстрима — нет; управление своими серверами и навыками — да", () => {
    expect(BuffBrand.kept({ id: "opencode.skill" }, false)).toBe(false)
    for (const id of [
      "buff.mcp",
      "buff.skill",
      "buff.custom",
      "buff.memory",
      "buff.hook",
      "buff.turn",
      "buff.session-marks",
      "buff.search",
      "buff.git",
      "buff.background",
      "buff.trust",
      "buff.automation",
      "buff.workflow",
      "buff.todo",
      "buff.plan",
      "buff.goal",
      "buff.side",
    ])
      expect(BuffBrand.kept({ id }, false)).toBe(true)
  })
  test("вход в Buff, контекст, инструменты и всё остальное — да", () => {
    for (const id of [
      "buff.login",
      "buff.context",
      "opencode.provider.dynamic",
      "opencode.wellknown",
      "opencode.agent",
    ])
      expect(BuffBrand.kept({ id }, false)).toBe(true)
  })
})

// #439: раннер пайплайна — тот же бинарь. Модель ему задаёт конфигурация прогона
// (OpenRouter или арендованный стенд), поэтому каталог и провайдеры из конфига нужны;
// вход разработчика и выбор контекста — нет, контекст пришёл окружением.
describe("какие плагины ядра запускает Buff Code как раннер", () => {
  test("каталог моделей и провайдеры из конфига — да", () => {
    for (const id of ["opencode.models.dev", "opencode.config.provider", "opencode.provider.dynamic", "opencode.agent"])
      expect(BuffBrand.kept({ id }, true)).toBe(true)
  })
  test("из провайдерских плагинов — только инфраструктура (#377)", () => {
    expect(BuffBrand.kept({ id: "opencode.provider.prompt-cache-key" }, true)).toBe(true)
    for (const id of ["opencode.provider.opencode", "opencode.provider.openai", "opencode.provider.ollama"])
      expect(BuffBrand.kept({ id }, true)).toBe(false)
  })
  test("вход разработчика, контекст, настройки из интерфейса, навыки апстрима и облачные поиски — нет", () => {
    for (const id of [
      "buff.login",
      "buff.context",
      "buff.mcp",
      "buff.skill",
      "buff.custom",
      "buff.memory",
      "buff.hook",
      "buff.turn",
      "buff.session-marks",
      "buff.search",
      "buff.git",
      "buff.background",
      "buff.trust",
      "buff.automation",
      "buff.workflow",
      "buff.todo",
      "buff.plan",
      "buff.goal",
      "buff.side",
      // #623: встроенные навыки апстрима — справка по OpenCode и отчёт в его GitHub — и раннеру ни к чему.
      "opencode.skill",
      "opencode.websearch.exa",
      "opencode.websearch.tinyfish",
    ])
      expect(BuffBrand.kept({ id }, true)).toBe(false)
  })
})
