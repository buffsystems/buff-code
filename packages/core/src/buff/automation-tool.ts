export * as BuffAutomationTool from "./automation-tool.js"

import { Schema } from "effect"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffSchedule } from "@opencode/schema/buff-schedule"
import { BuffLocale } from "./locale.js"

/**
 * Инструмент модели «создать автоматизацию» (#447). Человек просит в чате делать что-то
 * регулярно — модель составляет автоматизацию, человек подтверждает её запросом разрешения:
 * что, когда и где. Проект — каталог сессии, модель — модель сессии.
 */

export const name = "automation_create"
/** Действие в запросе разрешения: «разрешить всегда» у него нет — подтверждается каждая. */
export const action = BuffAutomation.PERMISSION_ACTION

export const description = `Create a scheduled automation: an agent task that Buff Code runs by itself on a schedule in this project, each run in a new session, even when the window is closed. The user confirms it before it is saved.

Call it when the user asks for something to happen regularly or at set times ("every morning check…", "each Monday at 9 summarise…", "every 2 hours run…").
Do not call it for a one-off task now, a wait inside this conversation, or a reminder with no agent work.

- title: short name of the automation, in the user's language.
- prompt: a self-contained task for a fresh session that cannot see this conversation; it must not create automations itself.
- schedule: local time, HH:MM; days of week 0 = Sunday … 6 = Saturday. One of: every N minutes/hours (interval), daily, on days of the week (weekly), every N weeks on days (weeks), monthly on day N (a day the month lacks runs on its last day).
- mode: permissions for runs nobody watches — "ask" (ask before edits and commands), "edit" (edit files, ask before commands), "full" (no questions inside the project). A run that asks waits until the user answers. Use "edit" unless the user said otherwise.`

export const Input = Schema.Struct({
  title: Schema.String.annotate({ description: "Short name of the automation" }),
  prompt: Schema.String.annotate({ description: "Self-contained task for each run" }),
  schedule: BuffAutomation.Schedule,
  mode: BuffAutomation.Mode,
})
export type Input = typeof Input.Type

export function draft(input: Input, directory: string, model: BuffAutomation.Draft["model"]): BuffAutomation.Draft {
  return { ...input, directory, ...(model ? { model } : {}) }
}

/**
 * Автоматизацию подтверждает человек всегда: правило «разрешить всё» агента или режим «полный
 * доступ» её не пропускают. Запрет остаётся запретом.
 */
export function confirmed(event: { readonly action: string; readonly effect: "allow" | "deny" | "ask" }) {
  return event.action === action && event.effect === "allow" ? "ask" : event.effect
}

const plural: BuffI18n.N = (count, forms, params) => BuffI18n.n(BuffLocale.current(), count, forms, params)

/** Строки запроса разрешения — то, что человек подтверждает, на его языке. */
export function resources(value: BuffAutomation.Draft): string[] {
  return BuffAutomation.confirmation(value, BuffLocale.t, plural).split("\n")
}

export function reply(automation: BuffAutomation.Draft & { readonly next: number }, now: Date): string {
  const summary = BuffSchedule.summary(automation.schedule)
  const next = BuffSchedule.nextLabel(new Date(automation.next), now)
  return `Automation «${automation.title}» created: ${summary}. Next run — ${next}. It is visible on the «Automations» page.`
}
