// Сценарии (#448): слова и форма запуска — общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffWorkflow } from "../src/buff-workflow.js"
import { BuffWorkflowFlow } from "../src/buff-workflow-flow.js"

// Слова схемы — английские; русские ожидания — через переводчик по каталогу (#472).
const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const args = {
  branch: { type: "string" as const, description: "Ветка", required: true },
  rounds: { type: "number" as const, default: 2 },
  dry: { type: "boolean" as const },
  filter: { type: "json" as const },
}

describe("arguments", () => {
  test("summarised in words", () => {
    expect(BuffWorkflowFlow.argsSummary(args, ru)).toBe(
      "Аргументы: branch — строка, обязательный; rounds — число, по умолчанию 2; dry — да/нет; filter — JSON",
    )
    expect(BuffWorkflowFlow.argsSummary({}, ru)).toBe("Без аргументов")
    expect(BuffWorkflowFlow.argsSummary({})).toBe("No arguments")
  })
  test("the start form begins with defaults as text", () => {
    expect(BuffWorkflowFlow.formTexts(args)).toEqual({ branch: "", rounds: "2", dry: "", filter: "" })
  })
  test("form texts → values by type; problems per field", () => {
    expect(BuffWorkflowFlow.formValues(args, { branch: "main", rounds: "3", dry: "true", filter: '{"a":1}' })).toEqual({
      values: { branch: "main", rounds: 3, dry: true, filter: { a: 1 } },
    })
    expect(BuffWorkflowFlow.formValues(args, { branch: "", rounds: "x", dry: "", filter: "" })).toEqual({
      problems: { branch: "Required argument.", rounds: "Must be a number." },
    })
  })
})

describe("asking the agent to fix", () => {
  test("a saved workflow: by name and file", () => {
    expect(BuffWorkflowFlow.fixSaved("review", "/w/review.dwf.ts", ru)).toBe(
      "Исправь сохранённый сценарий «review» (файл /w/review.dwf.ts) и сохрани его снова: ",
    )
  })
  test("a run: amend it by id", () => {
    expect(BuffWorkflowFlow.fixRun({ id: "wf1", label: "Ревью" }, ru)).toBe(
      "Исправь прогон сценария «Ревью» (wf1) через workflow_amend: ",
    )
  })
})

describe("a run in one line", () => {
  test("status, time, metrics", () => {
    const run = {
      status: "completed" as const,
      created: 0,
      updated: 3_000,
      finished: 3_000,
      metrics: BuffWorkflow.EMPTY_METRICS,
    }
    expect(BuffWorkflowFlow.runLine(run, 9_999, ru)).toBe("Выполнен · 3 с · 0 токенов · файлы +0 ~0 −0 · строки +0 −0")
  })
  test("the current phase of a running run", () => {
    const phases = BuffWorkflow.phases(
      ["Сбор", "Проверка"],
      [
        {
          id: "s",
          actor: "a",
          phase: "Сбор",
          instructions: "",
          status: "done",
          started: 0,
          metrics: BuffWorkflow.EMPTY_METRICS,
        },
        {
          id: "t",
          actor: "b",
          phase: "Проверка",
          instructions: "",
          status: "running",
          started: 0,
          metrics: BuffWorkflow.EMPTY_METRICS,
        },
      ],
    )
    expect(BuffWorkflowFlow.progress(phases, "running", ru)).toBe("Фаза 2 из 2: Проверка")
    expect(BuffWorkflowFlow.progress([], "running")).toBe("")
    expect(BuffWorkflowFlow.progress(phases, "completed")).toBe("")
  })
})

describe("labels", () => {
  test("every step and phase status has words", () => {
    for (const status of ["running", "waiting", "approval", "done", "cached", "failed"] as const)
      expect(BuffWorkflowFlow.STEP_LABEL[status]).toBeTruthy()
    for (const status of ["pending", "running", "done", "failed"] as const)
      expect(BuffWorkflowFlow.PHASE_LABEL[status]).toBeTruthy()
    for (const status of ["pending", "running", "completed", "errored", "stopped"] as const)
      expect(BuffWorkflowFlow.STATUS_LABEL[status]).toBeTruthy()
  })
})
