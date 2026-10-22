export * as BuffBrand from "./brand.js"

import { BuffRunnerMode } from "./runner.js"

/** В закрытом контуре каталог моделей берётся из вшитого снимка, без хождения наружу. */
export const OFFLINE_MODEL_CATALOG = true

/**
 * Чего нет ни у разработчика, ни у раннера: облачные веб-поиски апстрима — чужие сервисы, и его
 * встроенные навыки — справка по OpenCode и отчёт об ошибке в его GitHub (#445, у раннера — #623).
 */
const UPSTREAM_CUT = new Set([
  "opencode.websearch.exa",
  "opencode.websearch.firecrawl",
  "opencode.websearch.parallel",
  "opencode.websearch.tavily",
  "opencode.websearch.tinyfish",
  "opencode.skill",
])

/**
 * Раннер пайплайна (#439): модель ему называет конфигурация прогона — OpenRouter или
 * арендованный стенд — так что каталог и провайдеры из конфига нужны. Вход разработчика и
 * выбор контекста ему не нужны: контекст пришёл окружением. Правка MCP-серверов, навыков,
 * команд, субагентов и памяти из интерфейса (#444–#446) — тоже: интерфейса у раннера нет.
 * Хуки (#446) раннеру не даны: подтвердить хук проекта там некому. Предпросмотр отката (#449) —
 * и отметки сессий (#452) — тоже часть интерфейса.
 */
const RUNNER_CUT = new Set([
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
  "buff.snapshot-git",
  "buff.background",
  "buff.trust",
  "buff.automation",
  "buff.workflow",
  "buff.todo",
  "buff.plan",
  "buff.goal",
  "buff.side",
])

/**
 * Провайдерские плагины апстрима у раннера (#377): модель ему называет конфигурация прогона,
 * поэтому из них остаётся лишь инфраструктура — dynamic грузит SDK объявленного провайдера,
 * prompt-cache-key отвечает за кэш запросов. У разработчика (#562) — все.
 */
const RUNNER_PROVIDERS = new Set(["opencode.provider.dynamic", "opencode.provider.prompt-cache-key"])

export function kept(plugin: { id: string }, runner: boolean): boolean {
  if (UPSTREAM_CUT.has(plugin.id)) return false
  if (runner && plugin.id.startsWith("opencode.provider.") && !RUNNER_PROVIDERS.has(plugin.id)) return false
  return !runner || !RUNNER_CUT.has(plugin.id)
}

export function keepPlugin(plugin: { id: string }): boolean {
  return kept(plugin, BuffRunnerMode.active())
}
