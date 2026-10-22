// Buff (#470): команду, которую человек запустил сам («!»), он хочет видеть с выводом —
// группа из одних таких команд открыта сразу; вызовы агента по-прежнему свёрнуты.
import { expect, test } from "bun:test"
import { personShellOnly } from "./buff-person-shell"

test("группа из одних команд человека — открыта", () => {
  expect(personShellOnly([{ type: "shell" }])).toBe(true)
  expect(personShellOnly([{ type: "shell" }, { type: "shell" }])).toBe(true)
})

test("есть вызовы агента или размышления — свёрнута, как прежде", () => {
  expect(personShellOnly([{ type: "shell" }, { type: "tool" }])).toBe(false)
  expect(personShellOnly([{ type: "reasoning" }])).toBe(false)
  expect(personShellOnly([])).toBe(false)
})
