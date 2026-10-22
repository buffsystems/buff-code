// Цель сессии в окне (#463): загрузка, изменения по событию, пауза, продолжить, сбросить.
import { afterEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { BuffGoal } from "@opencode/schema/buff-goal"
import { createGoalController } from "./controller"

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

const goal = (status: BuffGoal.Status): BuffGoal.Goal => ({
  text: "Тесты зелёные",
  status,
  iteration: 2,
  started: 0,
  updated: 0,
})

function setup() {
  const calls: string[] = []
  let push: (event: { session: string; goal?: BuffGoal.Goal }) => void = () => {}
  const rpc = {
    get: async ({ session }: { session: string }) => (session === "s" ? { goal: goal("active") } : {}),
    pause: async () => {
      calls.push("pause")
      return { goal: goal("paused") }
    },
    resume: async () => {
      calls.push("resume")
      return { goal: goal("active") }
    },
    clear: async () => {
      calls.push("clear")
      return {}
    },
  }
  const controller = createRoot((dispose) => {
    disposers.push(dispose)
    return createGoalController({
      rpc,
      session: () => "s",
      subscribe: (handler) => {
        push = handler
        return () => {}
      },
      notify: () => {},
    })
  })
  return { controller, calls, push: (event: { session: string; goal?: BuffGoal.Goal }) => push(event) }
}

test("loads the session's goal", async () => {
  const { controller } = setup()
  await controller.refresh()
  expect(controller.goal()?.status).toBe("active")
})

test("changes of this session arrive by event; other sessions are ignored", async () => {
  const { controller, push } = setup()
  await controller.refresh()
  push({ session: "other", goal: goal("complete") })
  expect(controller.goal()?.status).toBe("active")
  push({ session: "s", goal: goal("checking") })
  expect(controller.goal()?.status).toBe("checking")
  push({ session: "s" })
  expect(controller.goal()).toBeUndefined()
})

test("pause, resume, clear", async () => {
  const { controller, calls } = setup()
  await controller.refresh()
  await controller.pause()
  expect(controller.goal()?.status).toBe("paused")
  await controller.resume()
  expect(controller.goal()?.status).toBe("active")
  await controller.clear()
  expect(controller.goal()).toBeUndefined()
  expect(calls).toEqual(["pause", "resume", "clear"])
})
