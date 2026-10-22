import { expect, test } from "bun:test"
import { currentRendererPage } from "./renderer-page"

test("the window is the React window", () => {
  expect(currentRendererPage()).toBe("react.html")
})
