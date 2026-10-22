// Автоматизации (#447): когда запускать, что записать в историю и чем кончился запуск.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffAutomationRunner } from "../../src/buff/automation-runner"
import { BuffAutomationStore } from "../../src/buff/automation-store"
import { fakeKV } from "./fake-kv"

const at = (text: string) => new Date(text).getTime()
const draft: BuffAutomation.Draft = {
  title: "Утренний отчёт",
  prompt: "Собери сводку",
  schedule: { kind: "daily", at: "09:00" },
  directory: "/p",
  mode: "edit",
}

function world(start = at("2026-10-01T08:00:00")) {
  let now = start
  let counter = 0
  const launched: Array<{ title: string; run: string; late?: boolean }> = []
  const interrupted: string[] = []
  let refuse: string | undefined
  const store = BuffAutomationStore.make(fakeKV(50))
  const deps: BuffAutomationRunner.Deps = {
    store,
    now: () => now,
    id: () => `id${String(++counter).padStart(4, "0")}`,
    launch: (automation, run) =>
      refuse
        ? Effect.fail(refuse)
        : Effect.sync(() => {
            launched.push({ title: automation.title, run: run.id, late: run.late })
            return `ses_${run.id}`
          }),
    interrupt: (session) => Effect.sync(() => void interrupted.push(session)),
  }
  const go = <A>(effect: Effect.Effect<A>) => Effect.runSync(effect)
  const create = () => go(BuffAutomationRunner.save(deps, undefined, draft)).automation!
  return {
    deps,
    go,
    create,
    launched,
    interrupted,
    store,
    set: (text: string) => void (now = at(text)),
    refuse: (reason: string | undefined) => void (refuse = reason),
    runs: (id: string) => go(store.runs(id)),
  }
}

describe("saving", () => {
  test("a new automation waits for its first time", () => {
    const w = world()
    const automation = w.create()
    expect(automation.next).toBe(at("2026-10-01T09:00:00"))
    expect(automation.count).toBe(0)
    expect(automation.paused).toBe(false)
  })
  test("a broken draft is not saved — the problem in the person's words (Russian until a language is chosen)", () => {
    const w = world()
    expect(w.go(BuffAutomationRunner.save(w.deps, undefined, { ...draft, title: "" }))).toEqual({
      problem: "Назовите автоматизацию.",
    })
    expect(w.go(w.store.list())).toEqual([])
  })
  test("a changed schedule counts from the change", () => {
    const w = world()
    const automation = w.create()
    w.set("2026-10-01T08:30:00")
    const saved = w.go(
      BuffAutomationRunner.save(w.deps, automation.id, {
        ...draft,
        schedule: { kind: "interval", every: 2, unit: "hours" },
      }),
    ).automation!
    expect(saved.next).toBe(at("2026-10-01T10:30:00"))
    expect(saved.created).toBe(automation.created)
  })
})

describe("the clock", () => {
  test("on time — one session, the next time planned", () => {
    const w = world()
    const automation = w.create()
    w.set("2026-10-01T09:00:10")
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.launched).toEqual([{ title: "Утренний отчёт", run: "id0002", late: false }])
    const after = w.go(w.store.get(automation.id))!
    expect(after.next).toBe(at("2026-10-02T09:00:00"))
    expect(after.count).toBe(1)
    expect(after.last).toMatchObject({ status: "running", session: "ses_id0002", source: "schedule" })
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.launched).toHaveLength(1)
  })
  test("after the machine was off — one late run, the missed times in one skipped row", () => {
    const w = world()
    const automation = w.create()
    w.set("2026-10-04T10:00:00")
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.launched).toEqual([{ title: "Утренний отчёт", run: "id0003", late: true }])
    expect(w.runs(automation.id).map((run) => [run.status, run.skipped])).toEqual([
      ["running", undefined],
      ["skipped", 3],
    ])
  })
  test("the previous run still going — this time is skipped, not doubled", () => {
    const w = world()
    const automation = w.create()
    w.set("2026-10-01T09:00:00")
    w.go(BuffAutomationRunner.tick(w.deps))
    w.set("2026-10-02T09:00:00")
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.launched).toHaveLength(1)
    expect(w.runs(automation.id)[0]).toMatchObject({ status: "skipped", skipped: 1, reason: BuffAutomation.BUSY })
  })
  test("paused — nothing runs; resumed — counts from now, without catching up", () => {
    const w = world()
    const automation = w.create()
    w.go(BuffAutomationRunner.pause(w.deps, automation.id, true))
    w.set("2026-10-03T10:00:00")
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.launched).toHaveLength(0)
    const resumed = w.go(BuffAutomationRunner.pause(w.deps, automation.id, false)).automation!
    expect(resumed.next).toBe(at("2026-10-04T09:00:00"))
    expect(w.runs(automation.id)).toEqual([])
  })
  test("the session could not start — a failed run with the reason", () => {
    const w = world()
    const automation = w.create()
    w.refuse("Модель недоступна")
    w.set("2026-10-01T09:00:00")
    w.go(BuffAutomationRunner.tick(w.deps))
    expect(w.runs(automation.id)[0]).toMatchObject({ status: "failed", error: "Модель недоступна" })
    expect(w.go(w.store.get(automation.id))!.next).toBe(at("2026-10-02T09:00:00"))
  })
})

describe("by hand", () => {
  test("run now — a manual run; not while one is going", () => {
    const w = world()
    const automation = w.create()
    const first = w.go(BuffAutomationRunner.runNow(w.deps, automation.id))
    expect(first.run).toMatchObject({ source: "manual", status: "running" })
    expect(w.go(BuffAutomationRunner.runNow(w.deps, automation.id))).toEqual({
      problem: BuffAutomation.ALREADY_RUNNING,
    })
  })
  test("stop — the session is interrupted and the run is stopped, not succeeded", () => {
    const w = world()
    const automation = w.create()
    w.go(BuffAutomationRunner.runNow(w.deps, automation.id))
    expect(w.go(BuffAutomationRunner.stop(w.deps, automation.id))).toEqual({ stopped: true })
    expect(w.interrupted).toEqual(["ses_id0002"])
    expect(w.runs(automation.id)[0]?.status).toBe("stopped")
    expect(w.go(BuffAutomationRunner.stop(w.deps, automation.id))).toEqual({ stopped: false })
  })
})

describe("how a run ends", () => {
  const started = () => {
    const w = world()
    const automation = w.create()
    w.go(BuffAutomationRunner.runNow(w.deps, automation.id))
    const settle = (change: BuffAutomationRunner.Change) =>
      w.go(BuffAutomationRunner.settle(w.deps, "ses_id0002", change))
    return { w, automation, settle, last: () => w.runs(automation.id)[0]! }
  }
  test("succeeded, with the finish time", () => {
    const { w, settle, last } = started()
    w.set("2026-10-01T08:05:00")
    settle({ type: "succeeded" })
    expect(last()).toMatchObject({ status: "succeeded", finished: at("2026-10-01T08:05:00") })
  })
  test("failed — with the reason", () => {
    const { settle, last } = started()
    settle({ type: "failed", error: "Средства организации закончились." })
    expect(last()).toMatchObject({ status: "failed", error: "Средства организации закончились." })
  })
  test("asked for permission — waiting; answered — running again", () => {
    const { settle, last } = started()
    settle({ type: "asked" })
    expect(last().status).toBe("waiting")
    settle({ type: "replied" })
    expect(last().status).toBe("running")
  })
  test("interrupted by a person — stopped; by a restart — still running", () => {
    const one = started()
    one.settle({ type: "interrupted", reason: "shutdown" })
    expect(one.last().status).toBe("running")
    one.settle({ type: "interrupted", reason: "user" })
    expect(one.last().status).toBe("stopped")
  })
  test("cut off by inactivity — a failure that says why", () => {
    const one = started()
    one.settle({ type: "asked" })
    one.settle({ type: "interrupted", reason: "inactivity" })
    expect(one.last()).toMatchObject({ status: "failed", error: BuffAutomation.INACTIVE_WAITING })
    const two = started()
    two.settle({ type: "interrupted", reason: "inactivity" })
    expect(two.last()).toMatchObject({ status: "failed", error: BuffAutomation.INACTIVE })
  })
  test("a finished run is not rewritten by late events; a stranger session is ignored", () => {
    const { w, settle, last } = started()
    settle({ type: "succeeded" })
    settle({ type: "failed", error: "x" })
    expect(last().status).toBe("succeeded")
    w.go(BuffAutomationRunner.settle(w.deps, "ses_other", { type: "failed", error: "x" }))
  })
})
