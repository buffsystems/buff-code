// Фоновая работа (#456): остановленная человеком не будит модель; остановка — по идентификатору.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SubagentCompletion } from "../../src/session/subagent-completion"
import { BuffBackgroundStop } from "../../src/buff/background"

const recovery = {
  kind: "subagent" as const,
  parentSessionID: "ses_parent",
  childSessionID: "ses_child",
  agent: "general",
  description: "Inspect logs",
}

function deliver(status: "completed" | "cancelled") {
  const seen: Array<Record<string, unknown>> = []
  const sessions = { synthetic: (input: Record<string, unknown>) => Effect.sync(() => void seen.push(input)) }
  const jobs = { completeBackground: () => Effect.void }
  Effect.runSync(
    SubagentCompletion.deliver(sessions as never, jobs as never, { status, output: "done", recovery } as never),
  )
  return seen[0]!
}

describe("a background subagent's result", () => {
  test("stopped by the person — recorded, the parent is not woken", () => {
    const input = deliver("cancelled")
    expect(input.resume).toBe(false)
    expect(String(input.text)).toContain("Subagent cancelled: stopped by the user.")
  })
  test("finished by itself — the parent is woken, as before", () => {
    const input = deliver("completed")
    expect(input.resume).toBeUndefined()
    expect(String(input.text)).toContain("done")
  })
})

function world(job?: { type: string; status: string }) {
  const calls: string[] = []
  return {
    calls,
    deps: {
      job: (id: string) => Effect.succeed(job ? { id, ...job } : undefined),
      cancel: (id: string) => Effect.sync(() => void calls.push(`cancel ${id}`)),
      interrupt: (id: string) => Effect.sync(() => void calls.push(`interrupt ${id}`)),
      removeShell: (id: string) => Effect.sync(() => void calls.push(`remove ${id}`)),
    },
  }
}

describe("stopping by id", () => {
  test("a background command: its job is cancelled — the command is killed with it", () => {
    const { calls, deps } = world({ type: "shell", status: "running" })
    expect(Effect.runSync(BuffBackgroundStop.stop(deps, "sh_1"))).toEqual({ stopped: true })
    expect(calls).toEqual(["cancel sh_1"])
  })
  test("a background agent: its session is interrupted and its job cancelled", () => {
    const { calls, deps } = world({ type: "subagent", status: "running" })
    expect(Effect.runSync(BuffBackgroundStop.stop(deps, "ses_child"))).toEqual({ stopped: true })
    expect(calls).toEqual(["interrupt ses_child", "cancel ses_child"])
  })
  test("a command the person ran themselves has no job: it is removed", () => {
    const { calls, deps } = world()
    expect(Effect.runSync(BuffBackgroundStop.stop(deps, "sh_2"))).toEqual({ stopped: true })
    expect(calls).toEqual(["remove sh_2"])
  })
  test("an agent session with no job (started in the foreground) is interrupted", () => {
    const { calls, deps } = world()
    expect(Effect.runSync(BuffBackgroundStop.stop(deps, "ses_fg"))).toEqual({ stopped: true })
    expect(calls).toEqual(["interrupt ses_fg"])
  })
  test("work already finished is left alone", () => {
    const { calls, deps } = world({ type: "shell", status: "completed" })
    expect(Effect.runSync(BuffBackgroundStop.stop(deps, "sh_3"))).toEqual({ stopped: false })
    expect(calls).toEqual([])
  })
})
