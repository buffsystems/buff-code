import { expect, test } from "bun:test"
import { canNavigateHistory } from "../editor/controller"
import { createFilteredList, rankItems } from "./filtered"

type Item = { id: string; label: string; kind: string }
const items: Item[] = [
  { id: "f", label: "src/app.ts", kind: "file" },
  { id: "a", label: "@reviewer", kind: "agent" },
  { id: "s", label: "@skill", kind: "skill" },
]

test("groups keep their order and a query ranks by fuzzy match", () => {
  const options = { filterKeys: ["label"], groupBy: (item: Item) => item.kind, groupOrder: ["skill", "agent", "file"] }
  expect(rankItems(options, items, "").map((item) => item.id)).toEqual(["s", "a", "f"])
  expect(rankItems(options, items, "rev").map((item) => item.id)).toEqual(["a"])
})

test("an async source publishes only its latest answer", async () => {
  const slow = Promise.withResolvers<Item[]>()
  const list = createFilteredList<Item>({
    items: (query) => (query === "slow" ? slow.promise : items),
    filterKeys: ["label"],
  })
  list.filter("slow")
  list.filter("app")
  slow.resolve(items)
  await slow.promise
  expect(list.items().map((item) => item.id)).toEqual(["f"])
})

test("history recall starts from an empty prompt and moves at its edges", () => {
  expect(canNavigateHistory("up", "", 0, false)).toBe(true)
  expect(canNavigateHistory("up", "typed", 0, false)).toBe(false)
  expect(canNavigateHistory("down", "recalled", 8, true)).toBe(true)
  expect(canNavigateHistory("up", "recalled", 3, true)).toBe(false)
})
