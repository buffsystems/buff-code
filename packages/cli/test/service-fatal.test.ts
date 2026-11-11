import { describe, expect, test } from "bun:test"
import { serviceFatalLine } from "../src/service-fatal"

describe("serviceFatalLine (#880)", () => {
  const busy = new Error("Managed service port 49374 on 127.0.0.1 is already in use by another process.")
  test("the background service says why it stopped on stderr, for whoever started it", () => {
    expect(serviceFatalLine(["serve", "--service"], busy)).toBe(`${busy.message}\n`)
  })
  test("an interactive command keeps its usual report only", () => {
    expect(serviceFatalLine(["serve"], busy)).toBeUndefined()
    expect(serviceFatalLine(["run", "hi"], busy)).toBeUndefined()
  })
  test("a failure that is not an Error still has words", () => {
    expect(serviceFatalLine(["serve", "--service"], "boom")).toBe("boom\n")
  })
})
