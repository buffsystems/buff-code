// Цель сессии (#463), как в ZCode: ход → проверка → не достигнута — следующий ход; пауза, продолжить, сбросить.
import { describe, expect, test } from "bun:test"
import { BuffGoal } from "../src/buff-goal.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

const at = 1_000
const goal = (extra: Partial<BuffGoal.Goal> = {}): BuffGoal.Goal => ({
  text: "Все тесты зелёные",
  status: "active",
  iteration: 1,
  started: 0,
  updated: 0,
  ...extra,
})

describe("a goal's way", () => {
  test("set: the first iteration starts", () => {
    expect(BuffGoal.next(undefined, { type: "set", text: "Все тесты зелёные" }, at)).toEqual({
      goal: goal({ started: at, updated: at }),
      action: "start",
    })
  })
  test("a turn ends: the goal is checked", () => {
    expect(BuffGoal.next(goal(), { type: "turn", outcome: "succeeded" }, at)).toEqual({
      goal: goal({ status: "checking", updated: at }),
      action: "check",
    })
  })
  test("not reached: the next iteration, with the checker's reason", () => {
    expect(
      BuffGoal.next(goal({ status: "checking" }), { type: "verdict", complete: false, reason: "2 теста красные" }, at),
    ).toEqual({
      goal: goal({ iteration: 2, reason: "2 теста красные", updated: at }),
      action: "continue",
    })
  })
  test("reached: done, announced", () => {
    expect(
      BuffGoal.next(goal({ status: "checking" }), { type: "verdict", complete: true, reason: "всё зелёное" }, at),
    ).toEqual({
      goal: goal({ status: "complete", reason: "всё зелёное", updated: at, finished: at }),
      action: "done",
    })
  })
  test("a failed or interrupted turn pauses the goal with the reason", () => {
    expect(BuffGoal.next(goal(), { type: "turn", outcome: "failed", reason: "нет средств" }, at)).toEqual({
      goal: goal({ status: "paused", reason: "нет средств", updated: at }),
    })
    expect(BuffGoal.next(goal(), { type: "turn", outcome: "interrupted" }, at).goal?.status).toBe("paused")
  })
})

describe("the person's controls", () => {
  test("pause: no next iteration; a verdict while paused is kept, nothing continues", () => {
    const paused = BuffGoal.next(goal({ status: "checking" }), { type: "pause" }, at).goal!
    expect(paused.status).toBe("paused")
    expect(BuffGoal.next(paused, { type: "verdict", complete: false, reason: "ещё нет" }, at)).toEqual({
      goal: { ...paused, reason: "ещё нет" },
    })
    expect(BuffGoal.next(paused, { type: "turn", outcome: "succeeded" }, at)).toEqual({ goal: paused })
  })
  test("a check that arrives during a pause and reaches the goal completes it", () => {
    const paused = goal({ status: "paused" })
    expect(BuffGoal.next(paused, { type: "verdict", complete: true, reason: "готово" }, at)).toEqual({
      goal: goal({ status: "complete", reason: "готово", updated: at, finished: at }),
      action: "done",
    })
  })
  test("resume: idle — the next iteration starts now; busy — it waits for the turn", () => {
    const paused = goal({ status: "paused", iteration: 3 })
    expect(BuffGoal.next(paused, { type: "resume", idle: true }, at)).toEqual({
      goal: goal({ iteration: 4, updated: at }),
      action: "continue",
    })
    expect(BuffGoal.next(paused, { type: "resume", idle: false }, at)).toEqual({
      goal: goal({ iteration: 3, updated: at }),
    })
  })
  test("a pause can carry its reason", () => {
    expect(
      BuffGoal.next(goal({ status: "checking" }), { type: "pause", reason: "нет решения" }, at).goal,
    ).toMatchObject({
      status: "paused",
      reason: "нет решения",
    })
  })
  test("clear removes the goal", () => {
    expect(BuffGoal.next(goal(), { type: "clear" }, at)).toEqual({})
  })
  test("a new goal replaces the old one", () => {
    expect(BuffGoal.next(goal({ iteration: 5 }), { type: "set", text: "Другая" }, at).goal).toMatchObject({
      text: "Другая",
      iteration: 1,
    })
  })
  test("a done goal does not iterate on later turns", () => {
    const done = goal({ status: "complete" })
    expect(BuffGoal.next(done, { type: "turn", outcome: "succeeded" }, at)).toEqual({ goal: done })
  })
})

describe("words", () => {
  test("one line for the bar", () => {
    expect(BuffGoal.line(goal({ iteration: 3 }), ru)).toBe("Цель · итерация 3 · Идёт: Все тесты зелёные")
    expect(BuffGoal.line(goal({ status: "complete" }), ru)).toBe("Цель · итерация 1 · Достигнута: Все тесты зелёные")
  })
  test("the command text: set, or how to use", () => {
    expect(BuffGoal.parse("  Все тесты зелёные ")).toEqual({ text: "Все тесты зелёные" })
    expect(BuffGoal.parse("   ")).toEqual({ problem: BuffGoal.USAGE })
    expect(BuffGoal.parse("   ", ru)).toEqual({ problem: "Напишите цель после команды: /goal <чего добиться>." })
    expect(ru(BuffGoal.INTERRUPTED)).toBe("Ход остановлен — цель на паузе.")
    expect(BuffGoal.line(goal({ status: "paused" }))).toBe("Goal · iteration 1 · Paused: Все тесты зелёные")
  })
})
