export * as BuffMemoryTool from "./memory-tool.js"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { BuffMemoryNotes } from "@opencode/schema/buff-memory-notes"
import descriptionText from "./prompts/memory-save.md" with { type: "text" }

/**
 * Инструмент `memory_save` (#969): агент сохраняет одну заметку — факт или предпочтение — в
 * память проекта или аккаунта (файл MEMORY.md). Лента показывает сохранённое по записи вызова
 * (`metadata.memory`), и человек может тут же отменить. Что и когда сохранять, написано в
 * шаблоне описания (`prompts/memory-save.md`); здесь — только запись.
 */

export const TOOL = "memory_save"
export const description = descriptionText.trim()

export const Input = Schema.Struct({
  scope: Schema.Literals(["project", "account"]).annotate({
    description: "Where the note holds: this chat's project, or the user everywhere.",
  }),
  note: Schema.String.annotate({ description: "One self-contained sentence, in the user's language." }),
})

export const Output = Schema.Struct({ id: Schema.String, scope: Schema.Literals(["project", "account"]) })

/** Запись вызова для ленты. */
export interface Saved {
  action: "saved"
  scope: "project" | "account"
  id: string
  text: string
}

export const read = (file: string) => readFile(file, "utf8").catch(() => "")

export async function write(file: string, previous: string, notes: readonly BuffMemoryNotes.Note[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, BuffMemoryNotes.serialize(previous, notes))
}

/**
 * Сохраняет заметку в файл её области. Вне проекта (файла проекта нет) — в память аккаунта. Уже
 * сохранённое слово в слово второй раз не пишется: ответом идёт прежняя заметка.
 */
export async function save(
  files: { account: string; project?: string },
  input: { scope: "project" | "account"; note: string },
  made: { id: string; at: string; chat?: string },
): Promise<Saved> {
  const problem = BuffMemoryNotes.problem(input.note)
  if (problem) throw new Error(problem)
  const scope = input.scope === "project" && files.project ? "project" : "account"
  const file = scope === "project" ? files.project! : files.account
  return inTurn(file, () => saveTo(file, scope, input.note, made))
}

/**
 * Записи одного файла — по очереди. Модель зовёт `memory_save` несколько раз за шаг, вызовы идут
 * разом: каждый читал файл до чужой записи, и последняя затирала остальные, а повтор проходил
 * мимо проверки.
 */
const queues = new Map<string, Promise<unknown>>()
function inTurn<T>(file: string, run: () => Promise<T>): Promise<T> {
  const done = (queues.get(file) ?? Promise.resolve()).then(run, run)
  const settled = done.catch(() => undefined)
  queues.set(file, settled)
  void settled.then(() => {
    if (queues.get(file) === settled) queues.delete(file)
  })
  return done
}

async function saveTo(
  file: string,
  scope: "project" | "account",
  wanted: string,
  made: { id: string; at: string; chat?: string },
): Promise<Saved> {
  const previous = await read(file)
  const notes = BuffMemoryNotes.parse(previous)
  const text = BuffMemoryNotes.clean(wanted)
  const known = notes.find((note) => note.text.toLowerCase() === text.toLowerCase())
  if (known) return { action: "saved", scope, id: known.id, text: known.text }
  await write(file, previous, BuffMemoryNotes.add(notes, text, made))
  return { action: "saved", scope, id: made.id, text }
}

export function reply(saved: Saved): string {
  return `Saved to ${saved.scope} memory: ${saved.text}. The user sees the note and can remove it.`
}
