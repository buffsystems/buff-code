// A session's goal (#463): loading, changes by event, pause, resume, reset.
import { expect, test } from "bun:test"
import type { BuffGoal } from "@opencode/schema/buff-goal"
import { createGoalController } from "./controller"

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
  const controller = createGoalController({
    rpc,
    session: "s",
    subscribe: (handler) => {
      push = handler
      return () => {}
    },
    notify: () => {},
  })
  controller.start()
  return { controller, calls, push: (event: { session: string; goal?: BuffGoal.Goal }) => push(event) }
}

test("loads the session's goal", async () => {
  const { controller } = setup()
  await controller.refresh()
  expect(controller.store.get()?.status).toBe("active")
})

test("changes of this session arrive by event; other sessions are ignored", async () => {
  const { controller, push } = setup()
  await controller.refresh()
  push({ session: "other", goal: goal("complete") })
  expect(controller.store.get()?.status).toBe("active")
  push({ session: "s", goal: goal("checking") })
  expect(controller.store.get()?.status).toBe("checking")
  push({ session: "s" })
  expect(controller.store.get()).toBeUndefined()
})

test("reading is quiet: a server without goals shows nothing and says nothing", async () => {
  const notes: string[] = []
  const controller = createGoalController({
    rpc: {
      get: () => Promise.reject(new Error("no goals here")),
      pause: () => Promise.reject(new Error("no")),
      resume: async () => ({}),
      clear: async () => ({}),
    },
    session: "s",
    subscribe: () => () => {},
    notify: (text) => notes.push(text),
  })
  await controller.refresh()
  expect(controller.store.get()).toBeUndefined()
  expect(notes).toEqual([])
  await controller.pause()
  expect(notes).toEqual(["Failed — the service did not answer."])
})

test("pause, resume, clear", async () => {
  const { controller, calls } = setup()
  await controller.refresh()
  await controller.pause()
  expect(controller.store.get()?.status).toBe("paused")
  await controller.resume()
  expect(controller.store.get()?.status).toBe("active")
  await controller.clear()
  expect(controller.store.get()).toBeUndefined()
  expect(calls).toEqual(["pause", "resume", "clear"])
})
