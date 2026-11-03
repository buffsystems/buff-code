// Отметки видимости моделей на службе (#743): файл только владельцу, испорченный — пустой список.
import { expect, test } from "bun:test"
import { mkdtemp, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { prefsFile, readPrefs, writePrefs } from "../../src/buff/model-prefs"

const fresh = async () => prefsFile(path.join(await mkdtemp(path.join(os.tmpdir(), "models-")), "config"))

test("the window's choices round-trip and stay the owner's", async () => {
  const file = await fresh()
  expect(await readPrefs(file)).toEqual({ user: [] })
  const user = [
    { providerID: "anthropic", modelID: "sonnet", visibility: "show" as const },
    { providerID: "openrouter", modelID: "x", visibility: "hide" as const },
  ]
  await writePrefs(file, { user })
  expect(await readPrefs(file)).toEqual({ user })
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700)
})

test("a broken file or a stray entry reads as no choice", async () => {
  const file = await fresh()
  await writePrefs(file, { user: [] })
  await writeFile(file, "{ not json")
  expect(await readPrefs(file)).toEqual({ user: [] })
  await writeFile(
    file,
    JSON.stringify({ user: [{ providerID: "a" }, { providerID: "a", modelID: "b", visibility: "show" }] }),
  )
  expect(await readPrefs(file)).toEqual({ user: [{ providerID: "a", modelID: "b", visibility: "show" }] })
})
