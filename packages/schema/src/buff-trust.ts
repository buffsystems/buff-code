export * as BuffTrust from "./buff-trust.js"

import { Schema } from "effect"
import type { BuffCustom } from "./buff-custom.js"
import { BuffHook } from "./buff-hook.js"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Что в проекте ждёт подтверждения (#446): хуки и команды, которые пришли из репозитория и не
 * выполняются, пока человек их не проверил. Один список — для полосы над полем ввода в окне и
 * для команды /trust в консоли.
 */

export interface Item {
  readonly kind: "hook" | "command"
  readonly id: string
  readonly title: string
  readonly note: string
}

export function pending(
  commands: readonly BuffCustom.Entry[],
  hooks: readonly BuffHook.Entry[],
  t: BuffI18n.T = BuffI18n.english,
): Item[] {
  const waits = (entry: { enabled: boolean; trusted?: boolean }) => entry.enabled && entry.trusted === false
  return [
    ...hooks.filter(waits).map(
      (hook): Item => ({
        kind: "hook",
        id: hook.id,
        title: t("Hook «{id}»", { id: hook.id }),
        note: BuffHook.summary(hook, t),
      }),
    ),
    ...commands.filter(waits).map(
      (command): Item => ({
        kind: "command",
        id: command.id,
        title: t("Command /{id}", { id: command.id }),
        note: t("project command"),
      }),
    ),
  ]
}

export function line(
  items: readonly Item[],
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string | undefined {
  if (!items.length) return undefined
  const hooks = items.filter((item) => item.kind === "hook").length
  const commands = items.length - hooks
  const parts = [
    ...(hooks ? [n(hooks, "{n} hook|{n} hooks")] : []),
    ...(commands ? [n(commands, "{n} command|{n} commands")] : []),
  ]
  // Сказуемое согласуется с числом: «1 хук ждёт», «2 хука ждут», «1 хук и 1 команда ждут».
  const what = parts.length === 1 ? parts[0]! : t("{items} and {last}", { items: parts[0]!, last: parts[1]! })
  return n(
    parts.length === 1 ? items.length : 2,
    "{what} from the project is waiting for review and does not run yet.|{what} from the project are waiting for review and do not run yet.",
    { what },
  )
}

// --- общий переключатель (#457) ---------------------------------------------------------------

const portable = Schema.toStandardSchemaV1
const Policy = Schema.Struct({ askFirst: Schema.Boolean })

/**
 * Проверять ли хуки и команды проекта перед запуском. По умолчанию — да; выключить можно в
 * знакомстве и в настройках хуков: тогда пришедшее из проекта выполняется без подтверждения.
 */
export const Rpc = define({
  id: "buff.trust",
  methods: {
    get: { input: portable(Schema.Undefined), output: portable(Policy) },
    set: { input: portable(Policy), output: portable(Policy) },
  },
  events: { changed: { schema: portable(Policy) } },
})
