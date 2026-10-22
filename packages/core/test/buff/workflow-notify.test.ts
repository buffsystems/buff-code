// Сценарии (#448): итог прогона и вопрос актёра приходят в сессию, из которой запущено.
import { describe, expect, test } from "bun:test"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { WorkflowNotify } from "../../src/buff/workflow/notify"

const run: BuffWorkflow.Run = {
  id: "wf1",
  label: "Проверка ветки",
  directory: "/p",
  status: "completed",
  args: {},
  phases: [],
  commands: [],
  created: 1,
  updated: 2,
  result: { conclusion: "всё хорошо" },
  metrics: BuffWorkflow.EMPTY_METRICS,
}

describe("the completion notice", () => {
  test("status, result, every reported item, artifacts by title", () => {
    const text = WorkflowNotify.done(
      run,
      [{ value: { n: 1 } }, { value: { n: 2 } }],
      [{ id: "report", kind: "markdown", version: 1, title: "Отчёт", primary: true }],
    )
    expect(text).toContain('Workflow run "Проверка ветки" (wf1) finished: Completed.')
    expect(text).toContain('"conclusion": "всё хорошо"')
    expect(text).toContain('{"n":1}')
    expect(text).toContain('{"n":2}')
    expect(text).toContain("Отчёт (markdown, primary)")
  })
  test("names the script file to edit for an amend", () => {
    expect(WorkflowNotify.done({ ...run, scriptPath: "/d/wf1.ts" }, [], [])).toContain("Script file: /d/wf1.ts")
  })
  test("a failure says why and keeps what was reported", () => {
    const text = WorkflowNotify.done(
      { ...run, status: "errored", error: "boom", result: undefined },
      [{ value: "находка" }],
      [],
    )
    expect(text).toContain("finished: Script error: boom.")
    expect(text).toContain('"находка"')
  })
})

describe("the question notice", () => {
  test("who asks, what, and how to answer", () => {
    const text = WorkflowNotify.question(run, {
      id: "q1",
      actor: "ревьюер",
      step: "s1",
      text: "Какую ветку брать?",
      asked: 1,
    })
    expect(text).toContain('"ревьюер"')
    expect(text).toContain("Какую ветку брать?")
    expect(text).toContain('question_id: "q1"')
  })
})
