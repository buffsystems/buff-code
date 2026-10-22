export * as BuffCustomFlow from "./buff-custom-flow.js"

import { BuffCustom } from "./buff-custom.js"
import { BuffI18n } from "./buff-i18n.js"
import { tr, type Ui } from "./buff-mcp-flow.js"

/**
 * Команды и субагенты в консоли (#446): добавить, изменить, удалить, включить и выключить —
 * вопросами по очереди. Поля те же, что в форме окна: их задаёт описание вида. Диалоги
 * приходят снаружи, так что шаги проверяются без терминала. `undefined` — человек вышел из
 * вопроса; `problem` — ответ не годится, сохранять нечего.
 */

export type Problem = { readonly problem: string }
type Target = { readonly scope: BuffCustom.Scope; readonly id: string }
export type Saved = Target & {
  readonly values: Record<string, string>
  readonly body: string
  readonly previous?: Target
}

const scopes = (t: BuffI18n.T) => [
  { title: t("On my machine — for all projects"), value: "user" as const, description: t("stays on this machine") },
  { title: t("In this project"), value: "project" as const, description: t("goes to the repository") },
]

/** Спросить одно поле формы: выбор — списком, остальное — строкой. */
function ask(ui: Ui, field: BuffCustom.Field, current?: string): Promise<string | undefined> {
  const t = tr(ui)
  if (field.options)
    return ui.select<string>({
      title: t(field.label),
      options: field.options.map((option) => ({ title: t(option.label), value: option.value })),
    })
  return ui.prompt({
    title: t(field.label),
    description: [field.hint && t(field.hint), field.required ? undefined : t("You can leave it empty.")]
      .filter(Boolean)
      .join(" "),
    placeholder: field.placeholder && t(field.placeholder),
    value: current,
  })
}

const askBody = (ui: Ui, kind: BuffCustom.Kind, current?: string) => {
  const t = tr(ui)
  return ui.prompt({
    title: t(kind.body.label),
    description: t(kind.body.hint),
    placeholder: t(kind.body.placeholder),
    value: current,
  })
}

const filled = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).flatMap(([key, value]) => (value.trim() ? [[key, value.trim()]] : [])))

export async function add(ui: Ui, kind: BuffCustom.Kind): Promise<Saved | Problem | undefined> {
  const t = tr(ui)
  const scope = await ui.select<BuffCustom.Scope>({ title: t("Where to keep"), options: scopes(t) })
  if (!scope) return
  const id = await ui.prompt({ title: t("Short name"), description: t(kind.idHint), placeholder: kind.idPlaceholder })
  if (id === undefined) return
  const values: Record<string, string> = {}
  for (const field of kind.fields) {
    const value = await ask(ui, field)
    if (value === undefined) return
    values[field.key] = value
  }
  const body = await askBody(ui, kind)
  if (body === undefined) return
  const draft = { id: id.trim(), values: filled(values), body }
  const problem = BuffCustom.problem(kind, draft, t)
  return problem ? { problem } : { scope, ...draft }
}

const own = (entries: readonly BuffCustom.Entry[]) =>
  entries.filter((entry) => entry.scope === "user" || entry.scope === "project")

/** Строки списка: как запись вызывают, откуда она и выключена ли. */
export function rows(kind: BuffCustom.Kind, entries: readonly BuffCustom.Entry[], t: BuffI18n.T = BuffI18n.english) {
  return entries.map((entry) => ({
    title: BuffCustom.mention(kind, entry.id),
    value: entry.id,
    description: [
      t(BuffCustom.originLabel(kind, entry.scope)),
      entry.enabled ? entry.description?.replace(/\s+/g, " ").trim() : t(kind.words.off),
    ]
      .filter(Boolean)
      .join(" · "),
  }))
}

async function pick(ui: Ui, kind: BuffCustom.Kind, title: string, entries: readonly BuffCustom.Entry[]) {
  const id = await ui.select<string>({ title, options: rows(kind, entries, tr(ui)) })
  return entries.find((entry) => entry.id === id)
}

/** Правка — меню полей с текущими значениями: меняют нужное и сохраняют. */
export async function edit(
  ui: Ui,
  kind: BuffCustom.Kind,
  entries: readonly BuffCustom.Entry[],
  read: (target: Target) => Promise<{ values: Readonly<Record<string, string>>; body: string }>,
): Promise<Saved | Problem | undefined> {
  const t = tr(ui)
  const mine = own(entries)
  if (!mine.length) return { problem: t(kind.words.none) }
  const entry = await pick(ui, kind, t(kind.words.pick.edit), mine)
  if (!entry) return
  const target = { scope: entry.scope as BuffCustom.Scope, id: entry.id }
  const stored = await read(target)
  const values = BuffCustom.formValues(kind, stored.values)
  let body = stored.body
  for (;;) {
    const shown = (field: BuffCustom.Field) =>
      t(field.options?.find((option) => option.value === (values[field.key] ?? ""))?.label ?? "") || values[field.key]
    const choice = await ui.select<string>({
      title: kind.words.edit(entry.id, t),
      options: [
        ...kind.fields.map((field) => ({ title: t(field.label), value: field.key, description: shown(field) || "—" })),
        { title: t(kind.body.label), value: "body", description: body.replace(/\s+/g, " ").trim() },
        { title: t("Save"), value: "save" },
      ],
    })
    if (choice === undefined) return
    if (choice === "save") break
    if (choice === "body") {
      body = (await askBody(ui, kind, body)) ?? body
      continue
    }
    const field = kind.fields.find((item) => item.key === choice)
    const value = field ? await ask(ui, field, values[field.key]) : undefined
    if (field && value !== undefined) values[field.key] = value
  }
  const draft = { id: entry.id, values: filled(values), body }
  const problem = BuffCustom.problem(kind, draft, t)
  return problem ? { problem } : { ...target, ...draft, previous: target }
}

export async function remove(
  ui: Ui,
  kind: BuffCustom.Kind,
  entries: readonly BuffCustom.Entry[],
): Promise<Target | Problem | undefined> {
  const t = tr(ui)
  const mine = own(entries)
  if (!mine.length) return { problem: t(kind.words.none) }
  const entry = await pick(ui, kind, t(kind.words.pick.remove), mine)
  if (!entry) return
  const sure = await ui.confirm({
    title: kind.words.remove(entry.id, t),
    message: entry.path
      ? t("The file {file} will be deleted.", { file: entry.path })
      : t("The entry's file will be deleted."),
  })
  return sure ? { scope: entry.scope as BuffCustom.Scope, id: entry.id } : undefined
}

export async function toggle(
  ui: Ui,
  kind: BuffCustom.Kind,
  entries: readonly BuffCustom.Entry[],
): Promise<{ id: string; enabled: boolean } | undefined> {
  const entry = await pick(ui, kind, tr(ui)(kind.words.pick.toggle), entries)
  return entry ? { id: entry.id, enabled: !entry.enabled } : undefined
}
