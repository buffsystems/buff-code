// Страница сценариев (#448): сохранённые и прогоны, запуск с аргументами, остановка, продолжение, ответ, удаление.
import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffWorkflow } from "@opencode/schema/buff-workflow"
import type { BuffWorkflowRpc } from "@opencode/schema/buff-workflow-rpc"
import { createWorkflowsController } from "./controller"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)
const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

const saved = (name: string): BuffWorkflowRpc.Saved => ({
  meta: { name, description: `Про ${name}`, args: {} },
  path: `/w/${name}.dwf.ts`,
})
const run = (id: string, status: BuffWorkflow.RunStatus): BuffWorkflow.Run => ({
  id,
  label: id,
  directory: "/p",
  status,
  args: {},
  phases: [],
  commands: [],
  created: 1,
  updated: 2,
  metrics: BuffWorkflow.EMPTY_METRICS,
})

function setup(answer = true, t: BuffI18n.T = ru) {
  const calls: string[] = []
  const notes: string[] = []
  let list = [saved("review"), saved("audit")]
  const rpc = {
    list: async () => ({ saved: list, invalid: [{ path: "/w/bad.dwf.ts", problem: "Нет заголовка" }] }),
    read: async ({ name }: { name: string }) => ({
      meta: saved(name).meta,
      script: "return 1",
      path: saved(name).path,
    }),
    saveMeta: async ({ meta }: { name: string; meta: { description: string } }) =>
      meta.description ? {} : { problem: "The workflow has no description." },
    remove: async ({ name }: { name: string }) => {
      calls.push(`remove ${name}`)
      list = list.filter((item) => item.meta.name !== name)
      return { removed: true }
    },
    start: async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
      calls.push(`start ${name} ${JSON.stringify(args)}`)
      return name === "audit" ? { problems: { branch: "Required argument." } } : { run: "wf1", session: "ses_1" }
    },
    runs: async () => ({ runs: [run("wf1", "running"), run("wf0", "completed")] }),
    run: async ({ id }: { id: string }) => ({
      run: run(id, "running"),
      actors: [],
      steps: [],
      questions: [],
      artifacts: [],
      items: [],
      log: [],
    }),
    stop: async ({ id }: { id: string }) => {
      calls.push(`stop ${id}`)
      return { stopped: true }
    },
    resume: async ({ id }: { id: string }) => {
      calls.push(`resume ${id}`)
      return id === "wf0" ? { problem: "This run cannot be resumed." } : {}
    },
    answer: async ({ question, text }: { question: string; text: string }) => {
      calls.push(`answer ${question} ${text}`)
      return {}
    },
  }
  const controller = createRoot((dispose) => {
    disposers.push(dispose)
    return createWorkflowsController({
      rpc,
      directory: () => "/p",
      confirm: async () => answer,
      notify: (text) => void notes.push(text),
      t,
    })
  })
  return { controller, calls, notes }
}

test("loads saved workflows, unreadable files and runs together", async () => {
  const { controller } = setup()
  await controller.refresh()
  expect(controller.saved().map((item) => item.meta.name)).toEqual(["review", "audit"])
  expect(controller.invalid()).toEqual([{ path: "/w/bad.dwf.ts", problem: "Нет заголовка" }])
  expect(controller.runs().map((item) => item.id)).toEqual(["wf1", "wf0"])
  expect(controller.counts()).toEqual({ saved: 2, runs: 2, running: 1 })
})

test("start: problems per argument stay in the form; a started run refreshes the list", async () => {
  const { controller, calls } = setup()
  expect(await controller.start("audit", {}, "/p")).toEqual({ problems: { branch: "Обязательный аргумент." } })
  expect(await controller.start("review", { n: 1 }, "/p")).toEqual({ run: "wf1", session: "ses_1" })
  expect(calls).toEqual(["start audit {}", 'start review {"n":1}'])
})

test("remove asks first; declined — nothing happens", async () => {
  const declined = setup(false)
  await declined.controller.remove("review")
  expect(declined.calls).toEqual([])
  const agreed = setup(true)
  await agreed.controller.refresh()
  await agreed.controller.remove("review")
  expect(agreed.calls).toEqual(["remove review"])
  expect(agreed.controller.saved().map((item) => item.meta.name)).toEqual(["audit"])
})

test("stop and resume; a refusal comes back as a notice", async () => {
  const { controller, calls, notes } = setup()
  await controller.stop("wf1")
  await controller.resume("wf0")
  expect(calls).toEqual(["stop wf1", "resume wf0"])
  expect(notes).toEqual(["Этот прогон продолжить нельзя."])
})

test("words go out in the window's language: English as is", async () => {
  const { controller, notes } = setup(true, BuffI18n.english)
  await controller.resume("wf0")
  expect(notes).toEqual(["This run cannot be resumed."])
  expect(await controller.start("audit", {}, "/p")).toEqual({ problems: { branch: "Required argument." } })
})

test("description edits: a refusal stays in the editor", async () => {
  const { controller } = setup()
  expect(await controller.saveMeta("review", { name: "review", description: "", args: {} })).toBe(
    "Нет описания сценария.",
  )
  expect(await controller.saveMeta("review", { name: "review", description: "Новое", args: {} })).toBeUndefined()
})

test("answer a subagent's question", async () => {
  const { controller, calls } = setup()
  expect(await controller.answer("q1", "main")).toBeUndefined()
  expect(calls).toEqual(["answer q1 main"])
})
