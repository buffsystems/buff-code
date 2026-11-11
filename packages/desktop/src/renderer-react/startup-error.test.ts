import { describe, expect, test } from "bun:test"
import { startupErrorReason } from "./startup-error"

describe("startupErrorReason (#880)", () => {
  test("the service's own words come through the IPC wrapper", () => {
    const defect = new Error("Managed service port 49374 on 127.0.0.1 is already in use by another process.")
    expect(startupErrorReason(new Error("Desktop IPC handler failed", { cause: defect }))).toBe(
      "Managed service port 49374 on 127.0.0.1 is already in use by another process.",
    )
  })
  test("the deepest words of a chain of causes — past Effect's own wrappers", () => {
    const port = new Error("Managed service port 49374 on 127.0.0.1 is already in use by another process.")
    const effect = new Error("An error occurred in Effect.tryPromise", { cause: port })
    expect(startupErrorReason(new Error("Desktop IPC handler failed", { cause: effect }))).toBe(port.message)
  })
  test("a plain failure, a string or an object with a message", () => {
    expect(startupErrorReason(new Error("boom"))).toBe("boom")
    expect(startupErrorReason("no server")).toBe("no server")
    expect(startupErrorReason({ message: "refused" })).toBe("refused")
  })
  test("a defect without words still says something", () => {
    expect(startupErrorReason(new Error("Desktop IPC handler failed", { cause: { _tag: "X" } }))).toBe(
      "Desktop IPC handler failed",
    )
  })
})
