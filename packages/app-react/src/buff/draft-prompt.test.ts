import { expect, test } from "bun:test"
import { leaveDraftPrompt, takeDraftPrompt } from "./draft-prompt"

test("a prompt left for a draft is taken once", () => {
  leaveDraftPrompt("d1", "fix the run")
  expect(takeDraftPrompt("d2")).toBeUndefined()
  expect(takeDraftPrompt("d1")).toBe("fix the run")
  expect(takeDraftPrompt("d1")).toBeUndefined()
})
