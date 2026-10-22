// Режим раннера (#439) читается из окружения при обращении: встраивающий процесс (SDK, тесты)
// может включить его до создания экземпляра, а не только до загрузки модуля.
import { afterEach, describe, expect, test } from "bun:test"
import { BuffRunner } from "@opencode/schema/buff-runner"
import { BuffRunnerMode } from "../../src/buff/runner"

const before = process.env[BuffRunner.ENV]
afterEach(() => {
  if (before === undefined) delete process.env[BuffRunner.ENV]
  else process.env[BuffRunner.ENV] = before
})

describe("runner mode", () => {
  test("follows the environment", () => {
    delete process.env[BuffRunner.ENV]
    expect(BuffRunnerMode.active()).toBe(false)
    process.env[BuffRunner.ENV] = JSON.stringify({ org: "acme" })
    expect(BuffRunnerMode.active()).toBe(true)
    expect(BuffRunnerMode.sink()).toBeNull()
  })
  test("a broken context fails loudly, not as a developer", () => {
    process.env[BuffRunner.ENV] = "{not json"
    expect(() => BuffRunnerMode.active()).toThrow()
  })
})
