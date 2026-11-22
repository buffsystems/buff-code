export * as BuffProjectDir from "./project-dir.js"

import path from "node:path"
import { statSync } from "node:fs"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { BuffNames } from "@opencode/schema/buff-names"
import { ProjectID } from "@opencode/schema/project-id"

/** Каталог Buff Code внутри `root` (#510): .buffcode, а у проекта, где есть только .opencode, — он. */
export function of(root: string): string {
  return BuffNames.pick(path.join(root, BuffNames.DIR), path.join(root, BuffNames.LEGACY_DIR), isDir)
}

/**
 * Личная папка проекта (#951): настройки «только у меня, только в этом проекте» — конфигурация
 * и навыки. Лежит у пользователя, в репозиторий не попадает; у всех рабочих копий проекта общая.
 * Вне проекта (домашняя папка, сама папка конфигурации, проект без идентификатора) её нет.
 */
export function personal(
  dirs: { readonly config: string; readonly home: string },
  project: { readonly id: string; readonly directory: string },
): string | undefined {
  if (project.id === ProjectID.global) return undefined
  if (project.directory === dirs.home || project.directory === dirs.config) return undefined
  return path.join(dirs.config, BuffNames.PERSONAL_PROJECTS_DIR, project.id)
}

/**
 * Личная папка проекта для ядра и его модулей — одно решение на всех: сравнение идёт по
 * настоящим путям (ссылки раскрыты), а сама папка — под каталогом конфигурации как он задан.
 */
export const personalFor = Effect.fnUntraced(function* (project: {
  readonly id: string
  readonly directory: string
}) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const [config, home, directory] = yield* Effect.forEach([global.config, global.home, project.directory], (item) =>
    fs.resolve(item),
  )
  if (!personal({ config, home }, { id: project.id, directory })) return undefined
  return personal({ config: global.config, home }, { id: project.id, directory })
})

function isDir(file: string): boolean {
  try {
    return statSync(file).isDirectory()
  } catch {
    return false
  }
}
