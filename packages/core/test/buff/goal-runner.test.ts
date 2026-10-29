// Цель сессии (#463): ход → проверка без записи в историю → следующий ход или «достигнута».
import { describe, expect, test } from "bun:test"
import type { BuffGoal } from "@opencode/schema/buff-goal"
import { GoalRunner } from "../../src/buff/goal/runner"

function world(verdicts: string[] = [], failure?: Error) {
  const goals = new Map<string, BuffGoal.Goal>()
  const prompts: { session: string; text: string; summary: string }[] = []
  const notes: { session: string; text: string }[] = []
  const checks: string[] = []
  const changes: (BuffGoal.Goal | undefined)[] = []
  let idle = true
  const runner = GoalRunner.make({
    store: {
      get: async (session) => goals.get(session),
      put: async (session, goal) => void goals.set(session, goal),
      remove: async (session) => void goals.delete(session),
    },
    prompt: async (session, text, summary) => void prompts.push({ session, text, summary }),
    generate: async (_, prompt) => {
      checks.push(prompt)
      if (failure) throw failure
      return verdicts.shift() ?? "{}"
    },
    announce: async (session, text) => void notes.push({ session, text }),
    idle: async () => idle,
    changed: (_, goal) => void changes.push(goal),
    directory: () => "/p",
    now: () => 1,
  })
  return { runner, goals, prompts, notes, checks, changes, busy: () => void (idle = false) }
}

describe("a goal", () => {
  test("set: stored and the first iteration prompted", async () => {
    const w = world()
    expect(await w.runner.set("s", "Все тесты зелёные")).toEqual({})
    expect(w.goals.get("s")).toMatchObject({ text: "Все тесты зелёные", status: "active", iteration: 1 })
    expect(w.prompts[0]!.text).toContain("Все тесты зелёные")
    // #711: the person sees the goal itself beside «Goal», not the model's instruction.
    expect(w.prompts[0]!.summary).toBe("Все тесты зелёные")
    expect(w.changes.length).toBe(1)
  })
  test("an empty text is refused", async () => {
    const w = world()
    expect(await w.runner.set("s", " ")).toHaveProperty("problem")
    expect(w.prompts).toEqual([])
  })
  test("not reached: the checker's reason goes into the next iteration", async () => {
    const w = world(['{"complete": false, "reason": "2 теста красные"}'])
    await w.runner.set("s", "Все тесты зелёные")
    await w.runner.turn("s", "succeeded")
    expect(w.checks[0]).toContain("Все тесты зелёные")
    expect(w.goals.get("s")).toMatchObject({ status: "active", iteration: 2, reason: "2 теста красные" })
    expect(w.prompts[1]!.text).toContain("2 теста красные")
    expect(w.prompts[1]!.summary).toBe("Итерация 2: 2 теста красные")
  })
  test("reached: done and announced, no more prompts", async () => {
    const w = world(['```json\n{"complete": true, "reason": "всё зелёное"}\n```'])
    await w.runner.set("s", "Все тесты зелёные")
    await w.runner.turn("s", "succeeded")
    expect(w.goals.get("s")).toMatchObject({ status: "complete", reason: "всё зелёное" })
    expect(w.notes[0]!.text).toBe("Цель достигнута: всё зелёное")
    expect(w.prompts.length).toBe(1)
  })
  test("an unreadable verdict is asked once more; still unreadable — paused with the answer, rather than looping", async () => {
    const w = world(["не знаю", "всё ещё не знаю"])
    await w.runner.set("s", "Цель")
    await w.runner.turn("s", "succeeded")
    expect(w.checks.length).toBe(2)
    expect(w.checks[1]).toContain("Answer now with the JSON object only")
    expect(w.goals.get("s")).toMatchObject({ status: "paused" })
    expect(w.goals.get("s")!.reason).toContain("не вынесла решения")
    expect(w.goals.get("s")!.reason).toContain("всё ещё не знаю")
  })
  test("a second check that reads fine decides", async () => {
    const w = world(["не знаю", '{"complete": true, "reason": "ок"}'])
    await w.runner.set("s", "Цель")
    await w.runner.turn("s", "succeeded")
    expect(w.goals.get("s")).toMatchObject({ status: "complete", reason: "ок" })
  })
  test("a failed check call pauses with its error", async () => {
    const w = world([], new Error("нет средств"))
    await w.runner.set("s", "Цель")
    await w.runner.turn("s", "succeeded")
    expect(w.goals.get("s")).toMatchObject({ status: "paused" })
    expect(w.goals.get("s")!.reason).toContain("нет средств")
  })
  test("pause, resume while idle — the next iteration; clear — gone", async () => {
    const w = world()
    await w.runner.set("s", "Цель")
    expect((await w.runner.pause("s")).goal?.status).toBe("paused")
    expect((await w.runner.resume("s")).goal).toMatchObject({ status: "active", iteration: 2 })
    expect(w.prompts.length).toBe(2)
    await w.runner.clear("s")
    expect(w.goals.has("s")).toBe(false)
  })
  test("turns of sessions without a goal are ignored", async () => {
    const w = world()
    await w.runner.turn("other", "succeeded")
    expect(w.checks).toEqual([])
  })
})

describe("the verdict text", () => {
  test("JSON anywhere in the answer", () => {
    expect(GoalRunner.verdict('Вот: {"complete": true, "reason": "ok"} — всё.')).toEqual({
      complete: true,
      reason: "ok",
    })
    expect(GoalRunner.verdict("{}")).toBeUndefined()
    expect(GoalRunner.verdict('{"complete": "yes", "reason": "x"}')).toBeUndefined()
  })
})
