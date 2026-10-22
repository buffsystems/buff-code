import { isCancel, log, select, type Option } from "@clack/prompts"
import type { BuffContext } from "@opencode/schema/buff-context"
import type { Ask } from "@opencode/schema/buff-context-flow"
import { t } from "../../../buff/locale"

/**
 * Рабочий контекст Buff в консоли (#391, #401): отдельных команд нет — разовая команда
 * спрашивает его при запуске (`setup.ts`), в терминальном интерфейсе — /org, /project, /space.
 */

export type Choice = BuffContext.Choice

/** «acme › shop · пространства: handbook» — так контекст показывают все наши экраны. */
export function describe(choice: Choice | null): string {
  if (!choice) return t("no context selected")
  const head = `${choice.org} › ${choice.project ?? t("no project")}`
  return choice.spaces.length ? t("{head} · spaces: {spaces}", { head, spaces: choice.spaces.join(", ") }) : head
}

/** Шаги выбора (общие с TUI и десктопом) — вопросами консоли. undefined — отмена. */
export const consoleAsk: Ask = async (dialog) => {
  // #470: выбирать не из чего — сказать почему.
  if (dialog.options.length === 0 && dialog.empty) {
    log.warn(dialog.empty)
    return undefined
  }
  const value = await select({
    message: dialog.title,
    options: dialog.options.map(
      (option) =>
        ({
          value: option.value,
          label: option.title,
          ...(option.description ? { hint: option.description } : {}),
        }) as Option<typeof option.value>,
    ),
    initialValue: dialog.current,
  })
  return isCancel(value) ? undefined : (value as never)
}
