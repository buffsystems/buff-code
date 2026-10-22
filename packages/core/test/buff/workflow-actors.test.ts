// Сценарии (#448): задание актёру — сессия-субагент; типизированный результат сдаётся инструментом.
import { describe, expect, test } from "bun:test"
import { WorkflowActors } from "../../src/buff/workflow/actors"
import { WorkflowExecute } from "../../src/buff/workflow/execute"

const tokens = (n: number) => ({ input: n, output: n, reasoning: 0, cache: { read: 0, write: 0 } })

function world(
  behaviour: {
    submit?: unknown
    fail?: { type: string; message: string; status?: number }
    text?: string
    slow?: number
  } = {},
) {
  const prompts: { session: string; text: string }[] = []
  const created: { parent: string; title: string; metadata: Record<string, unknown> }[] = []
  const steps: WorkflowActors.StepRecord[] = []
  const progress: { id: string; total: number }[] = []
  let spent = 0
  const results = WorkflowActors.results()
  const sessions: WorkflowActors.Sessions = {
    create: async (input) => {
      created.push(input)
      return "ses_" + created.length
    },
    prompt: async (input) => {
      prompts.push(input)
      spent += 10
      if (behaviour.submit !== undefined) results.submit(input.session, behaviour.submit)
      return { message: "msg_" + prompts.length }
    },
    wait: async () => {
      if (behaviour.slow) {
        await new Promise((resolve) => setTimeout(resolve, behaviour.slow))
        spent += 10
      }
    },
    state: async () => ({
      outcome: behaviour.fail ? "failed" : "succeeded",
      error: behaviour.fail,
      tokens: tokens(spent),
      providerID: "buff",
    }),
    lastText: async () => behaviour.text ?? "готово",
    diff: async () => [
      { status: "modified", additions: 3, deletions: 1 },
      { status: "added", additions: 10, deletions: 0 },
    ],
  }
  const ask = WorkflowActors.make({
    run: { id: "wf1", label: "Проверка", root: "ses_root", directory: "/p" },
    sessions,
    results,
    now: () => 1,
    step: (step) => void steps.push(step),
    progress: (id, metrics) => void progress.push({ id, total: metrics.tokens.total }),
    tick: 5,
  })
  return { ask, prompts, created, steps, results, progress }
}

const actor = { key: "ревьюер", name: "ревьюер", role: "Строгий ревьюер." }

describe("asking an actor", () => {
  test("the first ask opens the actor's session with an intro and the role; later asks are plain", async () => {
    const w = world()
    expect(await w.ask({ actor, instructions: "Проверь a.ts", key: "k1" })).toBe("готово")
    await w.ask({ actor, instructions: "И b.ts", key: "k2" })
    expect(w.created).toEqual([
      { parent: "ses_root", title: "Проверка · ревьюер", metadata: { buffWorkflow: { run: "wf1", actor: "ревьюер" } } },
    ])
    expect(w.prompts[0]!.text).toContain('named "ревьюер"')
    expect(w.prompts[0]!.text).toContain("Your role: Строгий ревьюер.")
    expect(w.prompts[0]!.text).toContain("working directory /p")
    expect(w.prompts[0]!.text).toContain("Проверь a.ts")
    expect(w.prompts[1]!.text).toBe("И b.ts")
  })
  test("a typed ask asks for workflow_result and returns the submitted value", async () => {
    const w = world({ submit: { ok: true } })
    const schema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    }
    expect(await w.ask({ actor, instructions: "Проверь", key: "k1", schema })).toEqual({ ok: true })
    expect(w.prompts[0]!.text).toContain("workflow_result")
    expect(w.prompts[0]!.text).toContain('"required": [')
  })
  test("no result submitted — one reminder, then a catchable failure", async () => {
    const w = world()
    const schema = { type: "object", properties: {}, required: [] }
    await expect(w.ask({ actor, instructions: "Проверь", key: "k1", schema })).rejects.toThrow(
      "did not submit a result",
    )
    expect(w.prompts).toHaveLength(2)
  })
  test("a provider failure stops the run, in words", async () => {
    const w = world({ fail: { type: "provider", message: "insufficient", status: 402 } })
    const failure = await w.ask({ actor, instructions: "x", key: "k1" }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WorkflowExecute.ProviderStop)
    expect((failure as Error).message).toContain("Средства организации закончились")
  })
  test("each step is recorded with its metrics: tokens, files, lines", async () => {
    const w = world()
    await w.ask({ actor, instructions: "Проверь", key: "k1", phase: "Проверить" })
    const last = w.steps.at(-1)!
    expect(last).toMatchObject({ id: "k1", actor: "ревьюер", phase: "Проверить", status: "done", result: "готово" })
    expect(last.metrics).toEqual({
      tokens: { input: 10, output: 10, cache: 0, total: 20 },
      files: { added: 1, deleted: 0, modified: 1 },
      lines: { added: 13, deleted: 1 },
    })
    expect(w.steps[0]).toMatchObject({ status: "running" })
  })
})

describe("results submitted by actors", () => {
  test("checked against the schema; mismatches go back to the actor", () => {
    const results = WorkflowActors.results()
    results.expect("ses_1", {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    })
    expect(results.submit("ses_1", { ok: "да" })).toEqual({ problems: ["ok: expected true/false"] })
    expect(results.submit("ses_1", { ok: true })).toEqual({})
    expect(results.take("ses_1")).toEqual({ value: { ok: true } })
    expect(results.submit("ses_2", {})).toEqual({ problems: ["No result is expected from this session right now."] })
  })
  test("a result sent as JSON text is read as the value it spells (models often send objects as strings)", () => {
    const results = WorkflowActors.results()
    results.expect("ses_1", { type: "object", properties: { count: { type: "number" } }, required: ["count"] })
    expect(results.submit("ses_1", '{"count": 0}')).toEqual({})
    expect(results.take("ses_1")).toEqual({ value: { count: 0 } })
    results.expect("ses_2", { type: "string" })
    expect(results.submit("ses_2", '{"count": 0}')).toEqual({})
    expect(results.take("ses_2")).toEqual({ value: '{"count": 0}' })
    results.expect("ses_3", { type: "object", properties: { count: { type: "number" } }, required: ["count"] })
    expect(results.submit("ses_3", "не json").problems?.length).toBe(1)
  })
})

describe("metrics of a step", () => {
  test("tokens grow while the actor works, not only at the end", async () => {
    const w = world({ slow: 40 })
    await w.ask({ actor, instructions: "Долго", key: "k1" })
    expect(w.progress.length).toBeGreaterThan(0)
    expect(w.progress[0]).toMatchObject({ id: "k1" })
    expect(w.progress.some((item) => item.total > 0)).toBe(true)
  })
  test("a failed step keeps the tokens it spent", async () => {
    const w = world({ fail: { type: "provider", message: "нет денег", status: 402 } })
    await w.ask({ actor, instructions: "x", key: "k1" }).catch(() => undefined)
    expect(w.steps.at(-1)).toMatchObject({ status: "failed" })
    expect(w.steps.at(-1)!.metrics.tokens.total).toBeGreaterThan(0)
  })
})
