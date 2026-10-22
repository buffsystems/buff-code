export * as BuffRipgrepStage from "./ripgrep"

import { existsSync } from "node:fs"
import { chmod, copyFile, rename, rm } from "node:fs/promises"
import path from "node:path"

/**
 * ripgrep сборки (#443) едет в ресурсах рядом с консолью, а служба запускается из её копии в
 * профиле (`userData/cli/<версия>`). Ядро ищет ripgrep рядом со своим исполняемым файлом —
 * значит, копия должна лечь и туда, в том числе к уже разложенной раньше версии.
 */

export function name(platform: string): string {
  return platform === "win32" ? "buff-rg.exe" : "buff-rg"
}

export async function stage(cli: string, directory: string, platform: string): Promise<void> {
  const source = path.join(path.dirname(cli), name(platform))
  const destination = path.join(directory, name(platform))
  if (!existsSync(source) || existsSync(destination)) return
  const temp = `${destination}.${process.pid}.tmp`
  try {
    await copyFile(source, temp)
    if (platform !== "win32") await chmod(temp, 0o755)
    await rename(temp, destination)
  } finally {
    await rm(temp, { force: true })
  }
}
