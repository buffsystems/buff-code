// Автоматизации (#447): хранятся в KV службы — каждая и каждый запуск отдельной записью.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffAutomationStore } from "../../src/buff/automation-store"
import { fakeKV } from "./fake-kv"

const automation = (id: string): BuffAutomation.Automation => ({
  id,
  title: `Задача ${id}`,
  prompt: "Проверь сборку",
  schedule: { kind: "daily", at: "09:00" },
  directory: "/p",
  mode: "edit",
  paused: false,
  created: 1,
  anchor: 1,
  next: 100,
  count: 0,
})
const run = (id: string, status: BuffAutomation.RunStatus = "running"): BuffAutomation.Run => ({
  id,
  automation: "a1",
  due: 100,
  started: 100,
  status,
  source: "schedule",
})

const go = <A>(effect: Effect.Effect<A>) => Effect.runSync(effect)

describe("the automation store", () => {
  test("automations and all their runs come back, newest run first — across scan pages", () => {
    const store = BuffAutomationStore.make(fakeKV())
    go(store.put(automation("a1")))
    go(store.put(automation("a2")))
    go(store.put(automation("a3")))
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) go(store.putRun(run(id, "succeeded")))
    expect(go(store.list()).map((item) => item.id)).toEqual(["a1", "a2", "a3"])
    expect(go(store.runs("a1")).map((item) => item.id)).toEqual(["r5", "r4", "r3", "r2", "r1"])
  })

  test("a run's change lands on its automation's last run; an older run does not displace it", () => {
    const store = BuffAutomationStore.make(fakeKV())
    go(store.put(automation("a1")))
    go(store.putRun(run("r2")))
    expect(go(store.get("a1"))?.last?.id).toBe("r2")
    go(store.putRun(run("r1", "failed")))
    expect(go(store.get("a1"))?.last?.id).toBe("r2")
    go(store.putRun(run("r2", "succeeded")))
    expect(go(store.get("a1"))?.last?.status).toBe("succeeded")
    go(store.putRun(run("r3", "skipped")))
    expect(go(store.get("a1"))?.last?.id).toBe("r2")
  })

  test("removing an automation removes its runs; removing a run keeps the rest", () => {
    const kv = fakeKV()
    const store = BuffAutomationStore.make(kv)
    go(store.put(automation("a1")))
    go(store.putRun(run("r1", "succeeded")))
    go(store.putRun(run("r2", "succeeded")))
    expect(go(store.removeRun("a1", "r1"))).toBe(true)
    expect(go(store.runs("a1")).map((item) => item.id)).toEqual(["r2"])
    expect(go(store.removeRun("a1", "r2"))).toBe(true)
    expect(go(store.get("a1"))?.last).toBeUndefined()
    go(store.putRun(run("r2", "succeeded")))
    expect(go(store.remove("a1"))).toBe(true)
    expect(go(store.get("a1"))).toBeUndefined()
    expect(kv.data.size).toBe(0)
  })

  test("a damaged record is passed over, not fatal", () => {
    const kv = fakeKV()
    const store = BuffAutomationStore.make(kv)
    go(store.put(automation("a1")))
    go(kv.set("a:broken", { title: 5 }))
    expect(go(store.list()).map((item) => item.id)).toEqual(["a1"])
  })
})
