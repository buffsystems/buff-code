// Побочный диалог (#464): ответвление, название по номеру, список у основной, первый вопрос.
import { expect, test } from "bun:test"
import type { BuffSide } from "@opencode/schema/buff-side"
import { SideRunner } from "../../src/buff/side/runner"

function world() {
  const lists = new Map<string, BuffSide.Side[]>()
  const calls: string[] = []
  let forks = 0
  const runner = SideRunner.make({
    store: {
      get: async (session) => lists.get(session) ?? [],
      put: async (session, sides) => void lists.set(session, [...sides]),
    },
    fork: async (session) => {
      calls.push(`fork ${session}`)
      return `side_${++forks}`
    },
    rename: async (session, title) => void calls.push(`rename ${session} ${title}`),
    prompt: async (session, text) => void calls.push(`prompt ${session} ${text}`),
    now: () => 7,
  })
  return { runner, lists, calls }
}

test("open: a fork of the session, titled by its number, remembered, asked the first question", async () => {
  const w = world()
  expect(await w.runner.open("main", "что значит X?")).toEqual({ id: "side_1", n: 1, at: 7 })
  expect(await w.runner.open("main")).toEqual({ id: "side_2", n: 2, at: 7 })
  expect(w.calls).toEqual([
    "fork main",
    "rename side_1 Побочный диалог 1",
    "prompt side_1 что значит X?",
    "fork main",
    "rename side_2 Побочный диалог 2",
  ])
  expect(await w.runner.list("main")).toEqual([
    { id: "side_1", n: 1, at: 7 },
    { id: "side_2", n: 2, at: 7 },
  ])
})

test("a session without side conversations lists none", async () => {
  expect(await world().runner.list("other")).toEqual([])
})
