export * as BuffMemoryFiles from "./memory-files.js"

import path from "node:path"
import type { BuffMemory } from "@opencode/schema/buff-memory"
import { BuffMemoryNotes } from "@opencode/schema/buff-memory-notes"

/**
 * Где лежат файлы памяти для каталога (#446): общий файл пользователя и AGENTS.md проекта —
 * от корня проекта вниз до открытого каталога, как их читает ядро. Без ввода-вывода.
 */
export interface Place {
  readonly path: string
  readonly scope: BuffMemory.Scope
  /** Файл заметок (MEMORY.md, #969), а не инструкций. */
  readonly notes?: true
}

const NAME = "AGENTS.md"

/**
 * `home` — дом пользователя: каталог в нём самом — чат вне проекта, заметок проекта там нет
 * (всё, что запоминается вне проекта, — память аккаунта).
 */
export function places(input: { user: string; root: string; directory: string; home?: string }): Place[] {
  const user: Place = { path: path.join(input.user, NAME), scope: "user" }
  const userNotes: Place = { path: path.join(input.user, BuffMemoryNotes.FILE), scope: "user", notes: true }
  const inside = input.directory === input.root || input.directory.startsWith(input.root + path.sep)
  if (!inside) return [user, userNotes]
  const below = path.relative(input.root, input.directory).split(path.sep).filter(Boolean)
  const directories = below.map((_, index) => path.join(input.root, ...below.slice(0, index + 1)))
  return [
    user,
    ...[input.root, ...directories].map((directory): Place => ({ path: path.join(directory, NAME), scope: "project" })),
    userNotes,
    ...(input.root === input.home
      ? []
      : [{ path: path.join(input.root, BuffMemoryNotes.FILE), scope: "project", notes: true } satisfies Place]),
  ]
}

/** Файлы заметок среди мест: аккаунта и — в проекте — проекта. */
export function notes(all: readonly Place[]): { account: string; project?: string } {
  const project = all.find((place) => place.notes && place.scope === "project")?.path
  return {
    account: all.find((place) => place.notes && place.scope === "user")!.path,
    ...(project ? { project } : {}),
  }
}

/** Что показать: существующие файлы и два места, куда пишут первым делом, — общий и корень проекта. */
export function shown(all: readonly Place[], existing: ReadonlySet<string>): Place[] {
  const first = new Set([
    all.find((place) => place.scope === "user" && !place.notes),
    all.find((place) => place.scope === "project" && !place.notes),
  ])
  return all.filter((place) => existing.has(place.path) || first.has(place))
}
