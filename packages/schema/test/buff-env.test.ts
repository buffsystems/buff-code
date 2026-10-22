import { describe, expect, test } from "bun:test"
import { BuffEnv } from "../src/buff-env.js"

// #510: переменные окружения под своими именами — BUFF_X вместо апстримной OPENCODE_X.
describe("переменные окружения Buff Code", () => {
  test("BUFF_X становится OPENCODE_X — ядро читает апстримные имена", () => {
    expect(BuffEnv.aliases({ BUFF_CONFIG_DIR: "/oc", BUFF_DISABLE_AUTOUPDATE: "1", PATH: "/bin" })).toEqual({
      OPENCODE_CONFIG_DIR: "/oc",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    })
  })

  test("свои переменные Buff Code не получают апстримных двойников", () => {
    expect(BuffEnv.aliases({ BUFF_RUNNER: "{}", BUFF_PROVIDER: "x", BUFF_CONNECTOR_URL: "u" })).toEqual({})
  })

  test("заданы обе — побеждает своя (её и переносим поверх)", () => {
    expect(BuffEnv.aliases({ BUFF_CONFIG_DIR: "/new", OPENCODE_CONFIG_DIR: "/old" })).toEqual({ OPENCODE_CONFIG_DIR: "/new" })
  })
})
