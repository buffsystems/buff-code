// Buff (#805): Enter while the agent works queues the prompt; what cannot be queued, and any
// prompt to an idle session, goes as before.
import { describe, expect, test } from "bun:test"
import { enterDelivery } from "../../src/component/prompt/delivery"

describe("enterDelivery", () => {
  test("queues a prompt sent while the agent is running", () => {
    expect(enterDelivery({ running: true, queueable: true })).toBe("queue")
  })
  test("sends at once when the session is idle", () => {
    expect(enterDelivery({ running: false, queueable: true })).toBe("steer")
  })
  test("a prompt that cannot be queued (shell, slash command, exit) is sent at once", () => {
    expect(enterDelivery({ running: true, queueable: false })).toBe("steer")
  })
})
