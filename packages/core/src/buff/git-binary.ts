export * as BuffGitBinary from "./git-binary.js"

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "path"
import { which } from "../util/which.js"

/**
 * Какой git запускать (#495). Снимки сессии (дифф и откат файлов) зовут `git add --sparse`, а он
 * есть только с git 2.35; на старом git (Ubuntu 20.04 — 2.25) снимок молча не делался. На Windows
 * git может не быть вовсе. Поэтому сборка кладёт рядом с бинарём свой git (`buff-git/`), а здесь
 * решается, кому какой: репозиторий человека — его git любой версии (его настройки, ключи, сеть),
 * встроенный — только если своего нет; снимки — системный от 2.35, иначе встроенный.
 */

export type Version = readonly [number, number, number]
export type Missing = { readonly reason: "old"; readonly version: string } | { readonly reason: "absent" }
export type Choice = {
  /** git для репозитория человека; без какого-либо git — просто `git` (запуск откажет, как раньше). */
  readonly repository: string
  /** git для снимков; нет — снимки отключены, причина в `missing`. */
  readonly snapshot: string | undefined
  readonly missing?: Missing
}

export const SNAPSHOT_MIN: Version = [2, 35, 0]

export function parseVersion(text: string): Version | undefined {
  const match = text.match(/git version (\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
}

export function snapshotReady(version: Version): boolean {
  for (const [index, required] of SNAPSHOT_MIN.entries()) {
    if (version[index] !== required) return version[index] > required
  }
  return true
}

export function bundledPath(execPath: string, platform: string): string {
  const root = path.join(path.dirname(execPath), "buff-git")
  // Linux: git ищет свой каталог программ по пути к себе (RUNTIME_PREFIX) — лежит прямо в нём.
  return platform === "win32" ? path.join(root, "cmd", "git.exe") : path.join(root, "libexec", "git-core", "git")
}

export function choose(input: {
  system: { path: string; version: Version | undefined } | undefined
  bundled: string | undefined
}): Choice {
  const { system, bundled } = input
  const repository = system?.path ?? bundled ?? "git"
  if (system?.version && snapshotReady(system.version)) return { repository, snapshot: system.path }
  if (bundled) return { repository, snapshot: bundled }
  const missing: Missing = system
    ? { reason: "old", version: system.version?.join(".") ?? "unknown" }
    : { reason: "absent" }
  return { repository, snapshot: undefined, missing }
}

/** Почему снимков нет — словами для лога и ошибки операции. */
export function missingMessage(missing: Missing | undefined): string {
  const required = SNAPSHOT_MIN.slice(0, 2).join(".")
  if (missing?.reason === "old")
    return `Session snapshots need git ${required} or newer; the system git is ${missing.version} and no bundled git was found`
  return `Session snapshots need git ${required} or newer; no git was found`
}

/** Лежит ли каталог в git-репозитории: `.git` (каталог или файл рабочей копии) где-то выше. Без
 *  запуска git — его-то как раз может не быть. */
export function insideRepository(directory: string, exists: (file: string) => boolean): boolean {
  for (let dir = directory; ; dir = path.dirname(dir)) {
    if (exists(path.join(dir, ".git"))) return true
    if (path.dirname(dir) === dir) return false
  }
}

function systemGit() {
  const found = which("git")
  if (!found) return undefined
  const probe = spawnSync(found, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"],
  })
  return { path: path.resolve(found), version: probe.status === 0 ? parseVersion(probe.stdout) : undefined }
}

let resolved: Choice | undefined

/** Выбор для этого процесса: git на машине за время работы не меняется — спрашиваем один раз. */
export function current(): Choice {
  if (resolved) return resolved
  const bundled = bundledPath(process.execPath, process.platform)
  resolved = choose({ system: systemGit(), bundled: existsSync(bundled) ? bundled : undefined })
  return resolved
}
