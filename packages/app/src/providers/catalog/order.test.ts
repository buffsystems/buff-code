import { expect, test } from "bun:test"
import { popularProviders } from "./order"

test("lists OpenCode Go and Zen after the other popular providers", () => {
  expect(popularProviders.slice(-2)).toEqual(["opencode-go", "opencode"])
})
