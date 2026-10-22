export * as BuffProjectDir from "./project-dir.js"

import path from "node:path"
import { statSync } from "node:fs"
import { BuffNames } from "@opencode/schema/buff-names"

/** Каталог Buff Code внутри `root` (#510): .buffcode, а у проекта, где есть только .opencode, — он. */
export function of(root: string): string {
  return BuffNames.pick(path.join(root, BuffNames.DIR), path.join(root, BuffNames.LEGACY_DIR), isDir)
}

function isDir(file: string): boolean {
  try {
    return statSync(file).isDirectory()
  } catch {
    return false
  }
}
