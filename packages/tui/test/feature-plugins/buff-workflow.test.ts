// Сценарии в консоли (#448): список, ход прогона и панели — строками выбора и текстом.
import { describe, expect, test } from "bun:test"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { WorkflowView } from "../../src/feature-plugins/buff/workflow-view"

const run = (id: string, status: BuffWorkflow.RunStatus, extra: Partial<BuffWorkflow.Run> = {}): BuffWorkflow.Run => ({
  id,
  label: `Прогон ${id}`,
  directory: "/p",
  status,
  args: {},
  phases: ["Сбор"],
  commands: [],
  created: 0,
  updated: 2_000,
  finished: 2_000,
  metrics: BuffWorkflow.EMPTY_METRICS,
  ...extra,
})
const detail = (extra: Partial<BuffWorkflowRpc.Detail> = {}): BuffWorkflowRpc.Detail => ({
  run: run("wf1", "running", { session: "ses_1" }),
  actors: [],
  steps: [
    {
      id: "s1",
      actor: "Счётчик",
      phase: "Сбор",
      instructions: "Посчитай",
      status: "done",
      started: 0,
      finished: 3_000,
      result: { count: 2 },
      metrics: BuffWorkflow.EMPTY_METRICS,
    },
  ],
  questions: [{ id: "q1", actor: "Счётчик", step: "s1", text: "Какую ветку?", asked: 1 }],
  artifacts: [
    { id: "t", kind: "table", version: 1, title: "Файлы", spec: { columns: [{ field: "f", label: "Файл" }] } },
  ],
  items: [{ value: { f: "a.txt" }, artifact: "t" }],
  log: [{ at: 0, text: "начали" }],
  ...extra,
})

describe("the list", () => {
  test("saved workflows, unreadable files and runs, grouped", () => {
    const options = WorkflowView.listOptions(
      {
        saved: [{ meta: { name: "review", description: "Ревью", args: {} }, path: "/w/review.dwf.ts" }],
        invalid: [{ path: "/w/bad.dwf.ts", problem: "Нет заголовка" }],
      },
      [run("wf1", "completed")],
      9_000,
    )
    expect(options.map((option) => [option.category, option.title, option.value])).toEqual([
      ["Сохранённые", "review", "saved:review"],
      ["Сохранённые", "/w/bad.dwf.ts", "invalid:/w/bad.dwf.ts"],
      ["Прогоны", "Прогон wf1", "run:wf1"],
    ])
    expect(options[0]!.description).toBe("Ревью · Без аргументов")
    expect(options[1]!.disabled).toBe(true)
    expect(options[2]!.description).toContain("Выполнен · 2 с")
  })
  test("nothing yet — a hint how to make one", () => {
    expect(WorkflowView.listOptions({ saved: [], invalid: [] }, [], 0)[0]!.disabled).toBe(true)
  })
})

describe("a run", () => {
  test("actions, waiting questions, phases with steps, artifacts, result and log", () => {
    const options = WorkflowView.runOptions(detail(), 4_000)
    const categories = [...new Set(options.map((option) => option.category))]
    expect(categories).toEqual(["Действия", "Вопросы субагентов", "1. Сбор — Готово", "Артефакты", "Журнал"])
    expect(options.filter((option) => option.category === "Действия").map((option) => option.value)).toEqual([
      "refresh",
      "stop",
      "session",
      "fix",
    ])
    expect(options.find((option) => option.value === "question:q1")?.title).toBe("Счётчик: Какую ветку?")
    expect(options.find((option) => option.value === "step:s1")).toMatchObject({ title: "Счётчик — Готово" })
    expect(options.find((option) => option.value === "artifact:t")?.description).toBe("таблица")
  })
  test("a subagent waiting for permission points to the session where it is answered", () => {
    const waiting = detail({ steps: [{ ...detail().steps[0]!, status: "approval", result: undefined }] })
    const option = WorkflowView.runOptions(waiting, 0).find((item) => item.category === "Ждут разрешения")
    expect(option).toMatchObject({ value: "session", title: "Счётчик ждёт вашего разрешения" })
  })
  test("a stopped run can be resumed; a finished one shows its result", () => {
    const stopped = WorkflowView.runOptions(detail({ run: run("wf1", "stopped", { stopReason: "user" }) }), 0)
    expect(stopped.some((option) => option.value === "resume")).toBe(true)
    const done = WorkflowView.runOptions(detail({ run: run("wf1", "completed", { result: 5 }) }), 0)
    expect(done.find((option) => option.value === "result")?.category).toBe("Итог")
  })
})

describe("texts", () => {
  test("a step: what was asked, its result or failure", () => {
    const text = WorkflowView.stepText(detail().steps[0]!, 4_000)
    expect(text).toContain("Поручено:\nПосчитай")
    expect(text).toContain('"count": 2')
  })
  test("a table panel as aligned columns", () => {
    expect(WorkflowView.artifactText(detail().artifacts[0]!, detail().items)).toBe("Файл\n-----\na.txt")
  })
  test("metric tiles, a chart and a board as lines", () => {
    const items = [{ value: { n: 1, x: "a", s: "Готово", k: 1 }, artifact: "p" }]
    expect(
      WorkflowView.artifactText(
        { id: "p", kind: "metrics", version: 1, spec: { metrics: [{ field: "n", label: "N" }] } },
        items,
      ),
    ).toBe("N: 1")
    expect(
      WorkflowView.artifactText(
        { id: "p", kind: "chart", version: 1, spec: { x: { field: "x" }, y: { field: "n", label: "N" } } },
        items,
      ),
    ).toBe("N: a=1")
    expect(
      WorkflowView.artifactText(
        { id: "p", kind: "board", version: 1, spec: { key: "k", status: "s", columns: ["Готово"] } },
        items,
      ),
    ).toBe("Готово (1):\n  • 1")
  })
  test("markdown as is; a file by its path", () => {
    expect(WorkflowView.artifactText({ id: "m", kind: "markdown", version: 1, content: "# Итог" }, [])).toBe("# Итог")
    expect(WorkflowView.artifactText({ id: "f", kind: "file", version: 1, path: "/a/f.html" }, [])).toBe(
      "Файл: /a/f.html",
    )
  })
})
