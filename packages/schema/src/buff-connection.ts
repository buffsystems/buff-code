export * as BuffConnection from "./buff-connection.js"

import { BuffI18n } from "./buff-i18n.js"
import { BuffMcp } from "./buff-mcp.js"
import { BuffSecret } from "./buff-secret.js"
import type { Mcp } from "./mcp.js"

/**
 * Подключения режима «Настройка» (#765): так модель называет MCP-серверы, которые ставит себе
 * сама. Здесь — имена инструментов и действий разрешений, строки подтверждения и слова статуса
 * для модели; одинаково для ядра, окна, консоли и телефона. Названий сервисов нет.
 */

export const TOOLS = {
  list: "connection_list",
  save: "connection_save",
  script: "connection_script",
  test: "connection_test",
  remove: "connection_remove",
  auth: "connection_auth",
  instructions: "connection_instructions",
} as const

/** Действия в запросах разрешения: подтверждаются каждый раз, «разрешить всегда» у них нет. */
export const SAVE_ACTION = "buff_connection_save"
export const REMOVE_ACTION = "buff_connection_remove"

/**
 * Возврат в приложение (#780): когда входят с телефона, loopback машины браузеру недоступен,
 * поэтому сервис после входа перенаправляет сюда; система открывает приложение Buff, и оно
 * само отвечает на форму входа кодом из адреса.
 */
export const APP_LINK = "buff://oauth"

/** Состояние попытки входа из адреса авторизации: по нему приложение узнаёт форму, которой принесло код. */
export function oauthState(url: string): string | undefined {
  return URL.parse(url)?.searchParams.get("state") ?? undefined
}

/** Идентификатор навыка с инструкциями к подключению: строчные буквы, цифры и дефис, как у навыков. */
export const skillID = (name: string): string =>
  `connection-${
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x"
  }`

/** Строки запроса разрешения на сохранение — что именно поставим или запустим. */
export function saveConfirmation(
  input: { readonly name: string; readonly scope: BuffMcp.Scope; readonly config: Mcp.ServerConfig },
  t: BuffI18n.T,
): string[] {
  const where = input.scope === "project" ? t("this project") : t("all projects")
  const lines = [t("Save connection «{name}» for {where}", { name: input.name, where })]
  if (input.config.type === "local") {
    lines.push(t("Run: {command}", { command: input.config.command.join(" ") }))
    const names = Object.keys(input.config.environment ?? {})
    if (names.length) lines.push(t("Environment: {names}", { names: names.join(", ") }))
  } else {
    lines.push(t("Address: {url}", { url: input.config.url }))
    const names = Object.keys(input.config.headers ?? {})
    if (names.length) lines.push(t("Headers: {names}", { names: names.join(", ") }))
    if (input.config.oauth !== false) lines.push(t("Sign-in through the service (OAuth) when needed"))
  }
  const secrets = referencedSecrets(input.config)
  if (secrets.length) lines.push(t("Uses secrets you entered: {count}", { count: secrets.length }))
  return lines
}

export function removeConfirmation(
  input: { readonly name: string; readonly secrets: number },
  t: BuffI18n.T,
): string[] {
  const lines = [t("Remove connection «{name}»", { name: input.name })]
  if (input.secrets) lines.push(t("Its secrets are deleted too: {count}", { count: input.secrets }))
  return lines
}

/** Идентификаторы секретов в настройках подключения — без значений. */
export function referencedSecrets(config: Mcp.ServerConfig): string[] {
  const values =
    config.type === "local"
      ? [...config.command, ...Object.values(config.environment ?? {})]
      : [
          config.url,
          ...Object.values(config.headers ?? {}),
          ...(config.oauth ? [config.oauth.client_id ?? "", config.oauth.client_secret ?? ""] : []),
        ]
  return [...new Set(values.flatMap((value) => BuffSecret.tokensIn(value)))]
}

/** Статус подключения словами для модели: ярлык и причина, по которой понятно, что чинить. */
export function statusForModel(status: Mcp.Status): string {
  const text = BuffMcp.statusText(status, BuffI18n.english)
  const reason = text.reason && text.reason !== text.details ? `${text.reason} (${text.details ?? ""})` : text.reason
  return reason ? `${text.label}: ${reason}` : text.label
}
