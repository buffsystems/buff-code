// Страница автоматизаций (#447): список с фильтрами, запуск вручную, остановка, удаление с подтверждением.
import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { BuffAutomation } from "@opencode/schema/buff-automation"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { createAutomationsController } from "./controller"

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

const automation = (id: string, extra: Partial<BuffAutomation.Automation> = {}): BuffAutomation.Automation => ({
  id,
  title: `Задача ${id}`,
  prompt: "p",
  schedule: { kind: "daily", at: "09:00" },
  directory: "/p",
  mode: "edit",
  paused: false,
  created: 1,
  anchor: 1,
  next: 2,
  count: 0,
  ...extra,
})

function setup(answer = true) {
  const calls: string[] = []
  const notes: string[] = []
  const asked: string[] = []
  let items = [
    automation("a"),
    automation("b", { paused: true }),
    automation("c", {
      last: { id: "r", automation: "c", due: 1, started: 1, status: "failed", source: "schedule", error: "x" },
    }),
  ]
  const rpc = {
    list: async () => ({ automations: items }),
    save: async ({ draft }: { draft: BuffAutomation.Draft }) =>
      draft.title === "bad" ? { problem: "Служба отказала." } : {},
    remove: async ({ id }: { id: string }) => {
      calls.push(`remove ${id}`)
      items = items.filter((item) => item.id !== id)
      return { removed: true }
    },
    pause: async ({ id, paused }: { id: string; paused: boolean }) => {
      calls.push(`pause ${id} ${paused}`)
      return {}
    },
    run: async ({ id }: { id: string }) => {
      calls.push(`run ${id}`)
      // Служба отвечает английской строкой схемы — окно показывает её на своём языке (#472).
      return id === "c" ? { problem: BuffAutomation.ALREADY_RUNNING } : {}
    },
    stop: async ({ id }: { id: string }) => {
      calls.push(`stop ${id}`)
      return { stopped: true }
    },
    runs: async () => ({ runs: [] }),
    removeRun: async () => ({ removed: true }),
  }
  return createRoot((dispose) => {
    disposers.push(dispose)
    const controller = createAutomationsController({
      rpc: rpc as never,
      directory: () => "/p",
      confirm: async (ask) => {
        asked.push(ask.title)
        return answer
      },
      notify: (text) => void notes.push(text),
      t: (text, params) => BuffI18n.t("ru", text, params),
    })
    return { controller, calls, notes, asked }
  })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("the list loads, and a filter keeps only what it names", async () => {
  const { controller } = setup()
  await controller.refresh()
  expect(controller.visible().map((item) => item.id)).toEqual(["a", "b", "c"])
  controller.setFilter("paused")
  expect(controller.visible().map((item) => item.id)).toEqual(["b"])
  controller.setFilter("failed")
  expect(controller.visible().map((item) => item.id)).toEqual(["c"])
  expect(controller.counts().failed).toBe(1)
})

test("run now — refused with the reason shown", async () => {
  const { controller, calls, notes } = setup()
  await controller.refresh()
  await controller.runNow("a")
  await controller.runNow("c")
  expect(calls).toEqual(["run a", "run c"])
  expect(notes).toEqual(["Запуск уже идёт — дождитесь его или остановите."])
})

test("delete — only after a yes", async () => {
  const no = setup(false)
  await no.controller.refresh()
  await no.controller.remove("a")
  expect(no.calls).toEqual([])
  expect(no.asked).toEqual(["Удалить автоматизацию «Задача a»?"])
  const yes = setup(true)
  await yes.controller.refresh()
  await yes.controller.remove("a")
  await tick()
  expect(yes.calls).toEqual(["remove a"])
  expect(yes.controller.visible().map((item) => item.id)).toEqual(["b", "c"])
})

test("pause and resume, stop", async () => {
  const { controller, calls } = setup()
  await controller.refresh()
  await controller.pause("a", true)
  await controller.pause("b", false)
  await controller.stop("c")
  expect(calls).toEqual(["pause a true", "pause b false", "stop c"])
})

test("save — a refusal comes back as words for the editor, without a toast", async () => {
  const { controller, notes } = setup()
  const draft = { ...automation("x"), title: "bad" }
  expect(await controller.save(undefined, draft)).toBe("Служба отказала.")
  expect(await controller.save(undefined, { ...draft, title: "ok" })).toBeUndefined()
  expect(notes).toEqual([])
})
