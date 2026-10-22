// Побочный диалог (#464): ответвление основной сессии — номер, название, список.
import { describe, expect, test } from "bun:test"
import { BuffSide } from "../src/buff-side.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("side conversations of a session", () => {
  test("numbered in order, titled for the user", () => {
    expect(BuffSide.title(1, ru)).toBe("Побочный диалог 1")
    expect(BuffSide.next([])).toBe(1)
    expect(
      BuffSide.next([
        { id: "a", n: 1, at: 0 },
        { id: "b", n: 3, at: 0 },
      ]),
    ).toBe(4)
  })
  test("the command text: a question to start with, or none", () => {
    expect(BuffSide.parse("  что значит X? ")).toEqual({ text: "что значит X?" })
    expect(BuffSide.parse("   ")).toEqual({})
  })
})

// #470: побочные диалоги хранятся по основной сессии; один ключ — у ядра и у сборки списков.
test("the store key of a main session's side conversations", () => {
  expect(BuffSide.storageKey("ses_main")).toBe("buff.side:ses_main")
  expect(BuffSide.storageKey("ses_main").startsWith(BuffSide.STORAGE_PREFIX)).toBe(true)
})

test("all side conversations from what the core keeps — broken entries skipped", () => {
  const kept = [
    [
      { id: "ses_a", n: 1, at: 1 },
      { id: "ses_b", n: 2, at: 2 },
    ],
    "broken",
    [{ id: "ses_c", n: 1, at: 3 }],
  ]
  expect(BuffSide.sideIDs(kept)).toEqual(["ses_a", "ses_b", "ses_c"])
})
