// Выбор рабочего контекста в терминальном интерфейсе (#391): чистая логика шагов.
import { expect, test } from "bun:test"
import {
  chooseOrg,
  chooseProject,
  chooseSpaces,
  preselectProject,
  type Ask,
} from "../../src/feature-plugins/buff/choose"

const options = {
  orgs: ["acme", "retail"],
  projects: [
    { org: "acme", name: "shop" },
    { org: "retail", name: "pos" },
  ],
  spaces: [
    { org: "acme", name: "handbook" },
    { org: "acme", name: "policies" },
  ],
}

/** A dialog double: answers in order and remembers what it was shown. */
function script(...answers: unknown[]) {
  const shown: { title: string; values: unknown[]; current?: unknown }[] = []
  const ask: Ask = async (dialog) => {
    shown.push({ title: dialog.title, values: dialog.options.map((o) => o.value), current: dialog.current })
    return answers.shift() as never
  }
  return { ask, shown }
}

test("a single organisation is taken without asking", async () => {
  const { ask, shown } = script()
  expect(await chooseOrg(ask, { ...options, orgs: ["acme"] }, null)).toBe("acme")
  expect(shown).toEqual([])
})

test("several organisations are offered, the current one preselected", async () => {
  const { ask, shown } = script("retail")
  expect(await chooseOrg(ask, options, { org: "acme", project: null, spaces: [] })).toBe("retail")
  expect(shown[0]).toMatchObject({ values: ["acme", "retail"], current: "acme" })
})

test("the project list is the organisation's own, plus «no project»", async () => {
  const { ask, shown } = script(null)
  expect(await chooseProject(ask, options, "acme", "shop")).toBeNull()
  expect(shown[0].values).toEqual(["shop", null])
  expect(shown[0].current).toBe("shop")
})

test("a cancelled dialog changes nothing", async () => {
  const { ask } = script(undefined)
  expect(await chooseProject(ask, options, "acme", null)).toBeUndefined()
  expect(await chooseOrg(script(undefined).ask, options, null)).toBeUndefined()
})

test("spaces are ticked and unticked until «done»", async () => {
  const DONE = Symbol.for("buff.done")
  const { ask, shown } = script("handbook", "policies", "handbook", DONE)
  expect(await chooseSpaces(ask, options, "acme", [])).toEqual(["policies"])
  expect(shown).toHaveLength(4)
})

test("an organisation without spaces needs no question", async () => {
  const { ask, shown } = script()
  expect(await chooseSpaces(ask, options, "retail", [])).toEqual([])
  expect(shown).toEqual([])
})

test("the first choice preselects nothing — one Enter must not silently mean «no project»", async () => {
  const { ask, shown } = script("shop")
  expect(await chooseProject(ask, options, "acme", undefined)).toBe("shop")
  expect(shown[0].current).toBeUndefined()
  const again = script(null)
  await chooseProject(again.ask, options, "acme", null) // an earlier «no project» is shown as such
  expect(again.shown[0].current).toBeNull()
})

test("what the project dialog preselects", () => {
  expect(preselectProject(null, "acme")).toBeUndefined() // first run: nothing
  expect(preselectProject({ org: "acme", project: "shop", spaces: [] }, "acme")).toBe("shop")
  expect(preselectProject({ org: "acme", project: null, spaces: [] }, "acme")).toBeNull()
  expect(preselectProject({ org: "retail", project: "pos", spaces: [] }, "acme")).toBeUndefined() // another org
})
