export * as BuffGitStage from "./git"

import { existsSync } from "node:fs"
import { cp, rename, rm } from "node:fs/promises"
import path from "node:path"

/**
 * Встроенный git (#495) едет в ресурсах рядом с консолью (`buff-git/`), а служба запускается из
 * копии консоли в профиле (`userData/cli/<версия>`). Ядро ищет встроенный git рядом со своим
 * исполняемым файлом — значит, каталог должен лечь и туда, в том числе к разложенной раньше версии.
 * Копия собирается во временном каталоге и встаёт на место одним переименованием: прерванная
 * раскладка не оставляет половину git.
 */

export const NAME = "buff-git"

export async function stage(cli: string, directory: string): Promise<void> {
  const source = path.join(path.dirname(cli), NAME)
  const destination = path.join(directory, NAME)
  if (!existsSync(source) || existsSync(destination)) return
  const temp = `${destination}.${process.pid}.tmp`
  try {
    await cp(source, temp, { recursive: true, preserveTimestamps: true })
    await rename(temp, destination)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
