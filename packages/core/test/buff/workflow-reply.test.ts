// Сценарии (#448): что модель получает от инструментов — диагностика по файлу, запуск, прогоны, пробный кусочек.
import { describe, expect, test } from "bun:test"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { WorkflowReply } from "../../src/buff/workflow/reply"

const run: BuffWorkflow.Run = {
  id: "wf1",
  label: "Проверка ветки",
  directory: "/p",
  status: "running",
  args: { branch: "main" },
  phases: ["Сбор", "Проверка"],
  commands: ["bun"],
  created: 1_000,
  updated: 2_000,
  scriptPath: "/d/wf1.ts",
  metrics: { ...BuffWorkflow.EMPTY_METRICS, tokens: { input: 10, output: 5, cache: 0, total: 1500 } },
}
const step = (
  id: string,
  phase: string | undefined,
  status: BuffWorkflow.StepStatus,
  extra = {},
): BuffWorkflow.Step => ({
  id,
  actor: "reviewer-" + id,
  ...(phase ? { phase } : {}),
  instructions: "Проверь " + id,
  status,
  started: 1,
  metrics: BuffWorkflow.EMPTY_METRICS,
  ...extra,
})

describe("the guide", () => {
  test("whole, with the facade the script is checked against", () => {
    const text = WorkflowReply.guide()
    expect(text).toContain("# Workflows in Buff Code")
    expect(text).toContain("declare interface Agent {")
    expect(text).not.toContain("{{facade}}")
  })
})

describe("diagnostics", () => {
  test("each one addresses the file; nothing ran; the file is the thing to edit", () => {
    const text = WorkflowReply.diagnostics("/d/x.ts", [
      { line: 3, column: 7, message: "Type 'string' is not assignable to type 'number'." },
      { line: 9, column: 1, message: "Date.now() is not allowed" },
    ])
    expect(text).toContain("/d/x.ts:L3:C7 Type 'string' is not assignable to type 'number'.")
    expect(text).toContain("/d/x.ts:L9:C1 Date.now() is not allowed")
    expect(text).toContain("Nothing ran")
    expect(text).toContain("`path`")
  })
})

describe("a started run", () => {
  test("names the run, its session and script file, and says not to poll", () => {
    const text = WorkflowReply.started({ run: "wf1", path: "/d/wf1.ts", phases: ["Сбор"] })
    expect(text).toContain("wf1")
    expect(text).toContain("/d/wf1.ts")
    expect(text).toContain("do not poll")
  })
})

describe("the list of runs", () => {
  test("every run: id, label, status in words, tokens", () => {
    const text = WorkflowReply.runs([run, { ...run, id: "wf2", status: "stopped", stopReason: "interrupted" }])
    expect(text).toContain("wf1 · Проверка ветки · Running · 1.5K tokens")
    expect(text).toContain("wf2 · Проверка ветки · Interrupted: the service closed — you can resume it")
  })
  test("none yet", () => expect(WorkflowReply.runs([])).toBe("No workflow runs yet."))
})

describe("one run", () => {
  test("status, script file, phases with every step, pending questions, items, artifacts, metrics, log", () => {
    const text = WorkflowReply.run({
      run,
      actors: [],
      steps: [
        step("a", "Сбор", "done", { result: { ok: true } }),
        step("b", "Проверка", "failed", { error: "сломалось" }),
        step("c", undefined, "running"),
      ],
      questions: [
        { id: "q1", actor: "reviewer-b", step: "b", text: "Какую ветку?", asked: 1 },
        { id: "q0", actor: "reviewer-a", step: "a", text: "Старый", asked: 1, answer: "main" },
      ],
      artifacts: [{ id: "report", kind: "markdown", version: 2, title: "Отчёт", primary: true }],
      items: [{ value: { n: 1 } }, { value: { row: 1 }, artifact: "table" }],
      log: [{ at: 1, text: "начали" }],
    })
    expect(text).toContain("wf1 · Проверка ветки · Running")
    expect(text).toContain("Script: /d/wf1.ts")
    expect(text).toContain('Args: {"branch":"main"}')
    expect(text).toContain("Phase 1. Сбор — done")
    expect(text).toContain('reviewer-a: done → {"ok":true}')
    expect(text).toContain("Phase 2. Проверка — failed")
    expect(text).toContain("reviewer-b: failed — сломалось")
    expect(text).toContain(`${BuffWorkflow.NO_PHASE} — running`)
    expect(text).toContain('question_id "q1" from reviewer-b: Какую ветку?')
    expect(text).not.toContain("Старый")
    expect(text).toContain('{"n":1}')
    expect(text).toContain('[table] {"row":1}')
    expect(text).toContain("Отчёт (markdown, v2, primary)")
    expect(text).toContain("начали")
    expect(text).toContain("1.5K tokens")
  })
  test("a finished run shows its result", () => {
    const text = WorkflowReply.run({
      run: { ...run, status: "completed", result: { verdict: "ок" } },
      actors: [],
      steps: [],
      questions: [],
      artifacts: [],
      items: [],
      log: [],
    })
    expect(text).toContain('"verdict": "ок"')
  })
})

describe("saved workflows", () => {
  test("name, description, when to use, arguments; unreadable files named", () => {
    const text = WorkflowReply.saved({
      saved: [
        {
          meta: {
            name: "review",
            description: "Ревью ветки",
            whenToUse: "Перед мержем",
            args: { branch: { type: "string", description: "Ветка", required: true } },
          },
          path: "/w/review.ts",
        },
      ],
      invalid: [{ path: "/w/bad.ts", problem: "Нет заголовка" }],
    })
    expect(text).toContain("review — Ревью ветки")
    expect(text).toContain("When: Перед мержем")
    expect(text).toContain("branch: string, required — Ветка")
    expect(text).toContain("/w/bad.ts: Нет заголовка")
  })
  test("none yet", () => expect(WorkflowReply.saved({ saved: [], invalid: [] })).toBe("No saved workflows."))
})

describe("a snippet", () => {
  test("its value and logs", () => {
    const text = WorkflowReply.evaluated({ outcome: { status: "completed", result: [1, 2] }, logs: ["раз"] })
    expect(text).toContain("[1,2]")
    expect(text).toContain("раз")
  })
  test("its error", () => {
    expect(WorkflowReply.evaluated({ outcome: { status: "errored", error: "boom" }, logs: [] })).toContain("boom")
  })
})
