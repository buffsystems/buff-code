export * as BuffMemoryFiles from "./memory-files.js"

import path from "node:path"
import type { BuffMemory } from "@opencode/schema/buff-memory"

/**
 * Где лежат файлы памяти для каталога (#446): общий файл пользователя и AGENTS.md проекта —
 * от корня проекта вниз до открытого каталога, как их читает ядро. Без ввода-вывода.
 */
export interface Place {
  readonly path: string
  readonly scope: BuffMemory.Scope
}

const NAME = "AGENTS.md"

export function places(input: { user: string; root: string; directory: string }): Place[] {
  const user: Place = { path: path.join(input.user, NAME), scope: "user" }
  const inside = input.directory === input.root || input.directory.startsWith(input.root + path.sep)
  if (!inside) return [user]
  const below = path.relative(input.root, input.directory).split(path.sep).filter(Boolean)
  const directories = below.map((_, index) => path.join(input.root, ...below.slice(0, index + 1)))
  return [
    user,
    ...[input.root, ...directories].map((directory): Place => ({ path: path.join(directory, NAME), scope: "project" })),
  ]
}

/** Что показать: существующие файлы и два места, куда пишут первым делом, — общий и корень проекта. */
export function shown(all: readonly Place[], existing: ReadonlySet<string>): Place[] {
  const first = new Set([all.find((place) => place.scope === "user"), all.find((place) => place.scope === "project")])
  return all.filter((place) => existing.has(place.path) || first.has(place))
}
