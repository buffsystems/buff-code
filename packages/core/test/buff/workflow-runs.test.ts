// Сценарии (#448): прогоны и журнал — в KV службы, переживают перезапуск; подробности собираются целиком.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { WorkflowRuns } from "../../src/buff/workflow/runs"
import { fakeKV } from "./fake-kv"

const go = <A>(effect: Effect.Effect<A>) => Effect.runSync(effect)
const run = (id: string, workflow = "review", updated = 1): BuffWorkflow.Run => ({
  id,
  label: "Проверка",
  workflow,
  directory: "/p",
  status: "running",
  args: {},
  phases: ["Шаг"],
  commands: [],
  created: 1,
  updated,
  metrics: BuffWorkflow.EMPTY_METRICS,
})

describe("workflow runs", () => {
  test("runs come back newest first, filtered by workflow", () => {
    const store = WorkflowRuns.make(fakeKV())
    go(store.putRun(run("r1", "review", 1)))
    go(store.putRun(run("r2", "other", 3)))
    go(store.putRun(run("r3", "review", 2)))
    expect(go(store.runs()).map((item) => item.id)).toEqual(["r2", "r3", "r1"])
    expect(go(store.runs("review")).map((item) => item.id)).toEqual(["r3", "r1"])
  })
  test("the journal survives: entries come back for a resume", () => {
    const store = WorkflowRuns.make(fakeKV())
    go(store.putEntry("r1", "ask:a:0:abc", { value: { ok: true } }))
    go(store.putEntry("r1", "obs:files.glob:[]:0", { value: ["a.ts"] }))
    expect(go(store.journal("r1"))).toEqual(
      new Map([
        ["ask:a:0:abc", { value: { ok: true } }],
        ["obs:files.glob:[]:0", { value: ["a.ts"] }],
      ]),
    )
  })
  test("the detail: actors, steps, questions, artifacts, reported items and log — all of them, in order", () => {
    const store = WorkflowRuns.make(fakeKV())
    go(store.putRun(run("r1")))
    go(store.putActor("r1", { key: "a", name: "a" }))
    const step = {
      id: "s1",
      actor: "a",
      instructions: "x",
      status: "done" as const,
      started: 1,
      metrics: BuffWorkflow.EMPTY_METRICS,
    }
    go(store.putStep("r1", step))
    go(store.putStep("r1", { ...step, status: "done", result: "ok" }))
    go(store.putQuestion("r1", { id: "q1", actor: "a", step: "s1", text: "Какую ветку?", asked: 2 }))
    go(store.putArtifact("r1", { id: "report", kind: "markdown", version: 1, content: "# Итог" }))
    for (const n of [1, 2, 3]) go(store.addItem("r1", { value: { n } }))
    go(store.addLog("r1", { at: 1, text: "начали" }))
    const detail = go(store.detail("r1"))
    expect(detail?.steps).toEqual([{ ...step, result: "ok" }])
    expect(detail?.items.map((item) => item.value)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(detail?.actors).toEqual([{ key: "a", name: "a" }])
    expect(detail?.questions[0]?.text).toBe("Какую ветку?")
    expect(detail?.artifacts[0]?.content).toBe("# Итог")
    expect(detail?.log).toEqual([{ at: 1, text: "начали" }])
  })
})
