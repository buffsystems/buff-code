// Фоновая работа в консоли (#456): к счётчику под полем ввода — сколько идёт самая давняя.
import { expect, test } from "bun:test"
import { countWithTime } from "../../src/feature-plugins/buff/background"

test("the counter gets the running time of the oldest one", () => {
  expect(countWithTime("2 shells", [10_000, 40_000], 75_000)).toBe("2 shells · 1 мин 05 с")
  expect(countWithTime("1 subagent", [70_000], 75_000)).toBe("1 subagent · 5 с")
})

test("no counter or no known start — the counter as it was", () => {
  expect(countWithTime(undefined, [10_000], 75_000)).toBeUndefined()
  expect(countWithTime("1 shell", [], 75_000)).toBe("1 shell")
})
