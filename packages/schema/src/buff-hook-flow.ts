export * as BuffHookFlow from "./buff-hook-flow.js"

import type { BuffI18n } from "./buff-i18n.js"
import { BuffHook } from "./buff-hook.js"
import { tr, type Ui } from "./buff-mcp-flow.js"
import type { BuffTrust } from "./buff-trust.js"

/**
 * Хуки и доверие в консоли (#446): добавить, удалить, включить и выключить хук; проверить и
 * подтвердить то, что пришло из проекта. Хук с тем же именем заменяется — так его и правят.
 * Диалоги приходят снаружи; `undefined` — человек вышел из вопроса, `problem` — ответ не годится.
 */

export type Problem = { readonly problem: string }
type Target = { readonly scope: BuffHook.Scope; readonly id: string }
export type Saved = Target & { readonly event: BuffHook.Event; readonly tool: string; readonly command: string }

const OWNER: Record<BuffHook.Scope, string> = { user: "my hook", project: "project" }
const none = (t: BuffI18n.T): Problem => ({ problem: t("No hooks yet. To add one — /hook-add.") })

export async function add(ui: Ui): Promise<Saved | Problem | undefined> {
  const t = tr(ui)
  const scope = await ui.select<BuffHook.Scope>({
    title: t("Where to keep the hook"),
    options: [
      { title: t("On my machine — for all projects"), value: "user", description: t("stays on this machine") },
      {
        title: t("In this project"),
        value: "project",
        description: t("goes to the repository; works for others after they confirm it"),
      },
    ],
  })
  if (!scope) return
  const id = await ui.prompt({
    title: t("Hook name"),
    description: t("Lowercase Latin letters, digits and hyphen."),
    placeholder: "format",
  })
  if (id === undefined) return
  const event = await ui.select<BuffHook.Event>({
    title: t("When to run"),
    options: BuffHook.EVENTS.map((item) => ({ title: t(item.label), value: item.value, description: t(item.hint) })),
  })
  if (!event) return
  const withTool = BuffHook.EVENTS.find((item) => item.value === event)?.tool
  const tool = withTool
    ? await ui.prompt({
        title: t("Tools"),
        description: t("Names separated by commas; an asterisk matches any ending. Empty — any tool."),
        placeholder: "edit, write",
      })
    : ""
  if (tool === undefined) return
  const command = await ui.prompt({
    title: t("Command"),
    description: t(
      "Runs in the shell in the project directory. The event arrives as JSON: on standard input and in BUFF_HOOK_EVENT.",
    ),
    placeholder: "bun run format",
  })
  if (command === undefined) return
  const hook = { id: id.trim(), event, tool: tool.trim(), command: command.trim() }
  const problem = BuffHook.problem(hook, t)
  return problem ? { problem } : { scope, ...hook }
}

/** Строки списка: значение — место в списке, потому что одно имя может быть и у меня, и в проекте. */
export function rows(entries: readonly BuffHook.Entry[], t: BuffI18n.T) {
  return entries.map((entry, value) => ({
    title: entry.id,
    value,
    description: [
      t(OWNER[entry.scope]),
      entry.trusted === false ? t("not confirmed") : undefined,
      entry.enabled ? undefined : t("disabled"),
      BuffHook.summary(entry, t),
      entry.command,
    ]
      .filter(Boolean)
      .join(" · "),
  }))
}

async function pick(ui: Ui, title: string, entries: readonly BuffHook.Entry[]) {
  const index = await ui.select<number>({ title, options: rows(entries, tr(ui)) })
  return index === undefined ? undefined : entries[index]
}

export async function remove(ui: Ui, entries: readonly BuffHook.Entry[]): Promise<Target | Problem | undefined> {
  const t = tr(ui)
  if (!entries.length) return none(t)
  const entry = await pick(ui, t("Which hook to delete"), entries)
  if (!entry) return
  const sure = await ui.confirm({
    title: t("Delete the hook «{id}»?", { id: entry.id }),
    message: t("The entry will be removed from {file}.", { file: entry.path }),
  })
  return sure ? { scope: entry.scope, id: entry.id } : undefined
}

export async function toggle(
  ui: Ui,
  entries: readonly BuffHook.Entry[],
): Promise<(Target & { enabled: boolean }) | Problem | undefined> {
  const t = tr(ui)
  if (!entries.length) return none(t)
  const entry = await pick(ui, t("Which hook to turn on or off"), entries)
  return entry ? { scope: entry.scope, id: entry.id, enabled: !entry.enabled } : undefined
}

/** Проверка перед доверием: человек выбирает запись, видит ровно то, что будет выполняться, и подтверждает. */
export async function trust(
  ui: Ui,
  items: readonly BuffTrust.Item[],
  review: (item: BuffTrust.Item) => Promise<{ text: string; token: string }>,
): Promise<{ item: BuffTrust.Item; token: string } | Problem | undefined> {
  const t = tr(ui)
  if (!items.length) return { problem: t("Nothing to check: everything that came from the project is confirmed.") }
  const index = await ui.select<number>({
    title: t("What to check"),
    options: items.map((item, value) => ({ title: item.title, value, description: item.note })),
  })
  const item = index === undefined ? undefined : items[index]
  if (!item) return
  const reviewed = await review(item)
  const sure = await ui.confirm({
    title: t("Trust: {title}?", { title: item.title }),
    message: `${reviewed.text}\n\n${t("This came from the project and will run on your machine. If it changes, you will be asked again.")}`,
  })
  return sure ? { item, token: reviewed.token } : undefined
}
