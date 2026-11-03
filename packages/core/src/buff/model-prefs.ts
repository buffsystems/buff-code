export * as BuffModelPrefsPlugin from "./model-prefs.js"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { Scope } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffModelPrefs } from "@opencode/schema/buff-model-prefs"
import { Global } from "@opencode/util/global"

/**
 * Отметки видимости моделей на службе (#743). Источник правды — окно (#584): оно присылает свой
 * список при каждом изменении и при каждом подключении, служба хранит последний присланный в
 * `<config>/model-prefs.json` (только владельцу) и читает его для телефона (`models.list`).
 */

export const prefsFile = (configDir: string) => path.join(configDir, "model-prefs.json")

const EMPTY: BuffModelPrefs.Prefs = { user: [] }

const isChoice = (value: unknown): value is BuffModelPrefs.Choice => {
  const c = value as Record<string, unknown> | null
  return (
    !!c &&
    typeof c.providerID === "string" &&
    typeof c.modelID === "string" &&
    (c.visibility === "show" || c.visibility === "hide")
  )
}

/** Отметки из файла; нет файла или он испорчен — пустой список, не ошибка. */
export async function readPrefs(file: string): Promise<BuffModelPrefs.Prefs> {
  const parsed = await readFile(file, "utf8")
    .then((text) => JSON.parse(text) as { user?: unknown })
    .catch(() => null)
  const user = Array.isArray(parsed?.user) ? parsed.user.filter(isChoice) : []
  return user.length ? { user } : EMPTY
}

/** Список целиком, через временный файл: читатель никогда не видит половину. */
export async function writePrefs(file: string, prefs: BuffModelPrefs.Prefs): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify({ user: prefs.user }, null, 2) + "\n", { mode: 0o600 })
  await rename(temp, file)
}

export const Plugin = define<Global.Service | Scope.Scope>({
  id: "buff.model-prefs",
  effect: Effect.fn(function* (ctx) {
    const file = prefsFile((yield* Global.Service).config)
    yield* ctx.rpc
      .register(BuffModelPrefs.Rpc, {
        prefs: () => Effect.promise(() => readPrefs(file)),
        setPrefs: (input) => Effect.promise(() => writePrefs(file, input)).pipe(Effect.as(undefined)),
      })
      .pipe(Effect.orDie)
  }),
})
