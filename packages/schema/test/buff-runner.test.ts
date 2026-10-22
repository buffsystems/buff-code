// Режим раннера (#439): контекст прогона приходит окружением, вопросов нет.
import { expect, test } from "bun:test"
import { BuffRunner } from "../src/buff-runner.js"

test("без переменной — не раннер", () => {
  expect(BuffRunner.parse({})).toBeNull()
  expect(BuffRunner.parse({ BUFF_RUNNER: "" })).toBeNull()
})

test("контекст прогона из переменной", () => {
  const ctx = BuffRunner.parse({
    BUFF_RUNNER: JSON.stringify({
      org: "acme",
      project: "shop",
      issue: 457,
      atom: 461,
      role: "develop",
      phase: "develop",
      job: "0199-abc",
      initiator: "ivan",
    }),
  })
  expect(ctx).toEqual({
    org: "acme",
    project: "shop",
    issue: 457,
    atom: 461,
    role: "develop",
    phase: "develop",
    job: "0199-abc",
    initiator: "ivan",
  })
})

test("достаточно организации: остальное — по роли прогона", () => {
  expect(BuffRunner.parse({ BUFF_RUNNER: '{"org":"acme"}' })).toEqual({ org: "acme" })
})

test("испорченный контекст — ошибка, а не тихий режим разработчика", () => {
  expect(() => BuffRunner.parse({ BUFF_RUNNER: "{" })).toThrow()
  expect(() => BuffRunner.parse({ BUFF_RUNNER: '{"project":"shop"}' })).toThrow()
})

test("заголовки запроса — ровно то, что известно", () => {
  expect(BuffRunner.headers({ org: "acme", project: null, issue: 457, role: "review" })).toEqual({
    "X-Buff-Org": "acme",
    "X-Buff-Issue": "457",
    "X-Buff-Role": "review",
  })
  expect(BuffRunner.headers({ org: "acme" })).toEqual({ "X-Buff-Org": "acme" })
  expect(BuffRunner.headers({ org: "acme", bill_class: "research" })["X-Buff-Class"]).toBe("research")
})

test("приёмник склада — адрес и пропуск; в заголовки контекста он не попадает", () => {
  const ctx = BuffRunner.parse({ BUFF_RUNNER: '{"org":"acme","sink":{"url":"http://api/engine/rows","token":"t"}}' })!
  expect(ctx.sink).toEqual({ url: "http://api/engine/rows", token: "t" })
  expect(BuffRunner.headers(ctx)).toEqual({ "X-Buff-Org": "acme" })
})
