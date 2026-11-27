// Облачная машина спит без дела (#969): служба автоматизаций пишет ближайший срок в файл, который
// назвала служба машины, — по нему машину будят к запуску.
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { BuffAutomationService } from "../../src/buff/automation-service"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

test("the next time is written when it changes, and only then", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wake-"))
  dirs.push(dir)
  const file = path.join(dir, "config", "wake.json")
  const write = BuffAutomationService.wakeWriter(file)
  await Effect.runPromise(write(1_800_000_000_000))
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ next: 1_800_000_000_000 })
  const first = (await stat(file)).mtimeMs
  await Bun.sleep(5)
  await Effect.runPromise(write(1_800_000_000_000))
  expect((await stat(file)).mtimeMs).toBe(first)
  await Effect.runPromise(write(null))
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ next: null })
})

test("without a file named — one's own computer — nothing is written", async () => {
  await Effect.runPromise(BuffAutomationService.wakeWriter(undefined)(1))
})
