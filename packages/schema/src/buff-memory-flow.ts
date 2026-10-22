export * as BuffMemoryFlow from "./buff-memory-flow.js"

import { BuffI18n } from "./buff-i18n.js"
import { tr, type Ui } from "./buff-mcp-flow.js"
import { BuffMemory } from "./buff-memory.js"

/**
 * Память в консоли (#446): общий выключатель, выключатель файла и заметка в файл — вопросами
 * по очереди. Полная правка текста — в окне или в своём редакторе: файл памяти — обычный
 * AGENTS.md. Диалоги приходят снаружи; `undefined` — человек вышел из вопроса.
 */

export type Action =
  | { readonly type: "enable"; readonly path?: string; readonly enabled: boolean }
  | { readonly type: "note"; readonly path: string; readonly text: string }

type State = { readonly enabled: boolean; readonly files: readonly BuffMemory.File[] }

const ALL = "all"
const OWNER: Record<BuffMemory.Scope, string> = { user: "my memory", project: "project" }

export function menu(state: State, now: number, t: BuffI18n.T = BuffI18n.english) {
  return [
    {
      title: t(state.enabled ? "All memory: turn off" : "All memory: turn on"),
      value: ALL,
      description: t(state.enabled ? "on now" : "off now — the model does not read it"),
    },
    ...state.files.map((file) => ({
      title: file.path,
      value: file.path,
      description: `${t(OWNER[file.scope])} · ${BuffMemory.note(file, state.enabled, now, t)}`,
    })),
  ]
}

export function actions(file: BuffMemory.File, t: BuffI18n.T = BuffI18n.english) {
  return [
    { title: t("Add a note"), value: "note" as const },
    ...(file.exists
      ? [{ title: t(file.enabled ? "Turn the file off" : "Turn the file on"), value: "toggle" as const }]
      : []),
  ]
}

export async function run(ui: Ui, state: State, now: number): Promise<Action | undefined> {
  const t = tr(ui)
  const picked = await ui.select<string>({ title: t("Memory"), options: menu(state, now, t) })
  if (picked === undefined) return
  if (picked === ALL) return { type: "enable", enabled: !state.enabled }
  const file = state.files.find((item) => item.path === picked)
  if (!file) return
  const action = await ui.select<"note" | "toggle">({ title: file.path, options: actions(file, t) })
  if (action === undefined) return
  if (action === "toggle") return { type: "enable", path: file.path, enabled: !file.enabled }
  const text = await ui.prompt({
    title: t("A note to memory"),
    description: t("One line: a rule or an agreement. It is appended to the end of the file."),
    placeholder: t("Run tests with make test"),
  })
  return text?.trim() ? { type: "note", path: file.path, text: text.trim() } : undefined
}

/** Текст файла с заметкой в конце — пунктом списка. */
export function withNote(text: string, note: string): string {
  const before = text.trimEnd()
  const gap = !before ? "" : /(^|\n)- [^\n]*$/.test(before) ? "\n" : "\n\n"
  return `${before}${gap}- ${note}\n`
}
