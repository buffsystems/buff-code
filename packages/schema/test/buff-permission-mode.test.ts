// Режим разрешений и запрос разрешения (#450): правила, общие для окна и консоли.
import { describe, expect, test } from "bun:test"
import { BuffPermissionMode as Mode } from "../src/buff-permission-mode.js"
import { BuffI18n } from "../src/buff-i18n.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

describe("what each mode asks about", () => {
  test("«ask» asks before edits and commands", () => {
    expect(Mode.rules("ask", false)).toEqual([
      { action: "edit", resource: "*", effect: "ask" },
      { action: "shell", resource: "*", effect: "ask" },
    ])
  })

  test("«edit» edits by itself and asks before commands", () => {
    expect(Mode.rules("edit", false)).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
  })

  test("«full» asks nothing inside the project", () => {
    expect(Mode.rules("full", false)).toEqual([])
  })

  test("in plan mode a rule about edits is never added — it would lift the plan agent's own ban on edits", () => {
    expect(Mode.rules("ask", true)).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
    expect(Mode.rules("edit", true)).toEqual([{ action: "shell", resource: "*", effect: "ask" }])
  })
})

describe("which mode a session is in", () => {
  test("is read back from its rules", () => {
    for (const mode of ["ask", "edit", "full"] as const) expect(Mode.modeOf(Mode.rules(mode, false), false)).toBe(mode)
    expect(Mode.modeOf(undefined, false)).toBe("full")
  })

  test("in plan mode «ask» and «edit» are the same rules — the stricter name is shown", () => {
    expect(Mode.modeOf(Mode.rules("edit", true), true)).toBe("ask")
    expect(Mode.modeOf([], true)).toBe("full")
  })

  test("rules written by something else are not given a mode's name", () => {
    expect(Mode.modeOf([{ action: "webfetch", resource: "*", effect: "deny" }], false)).toBeUndefined()
  })
})

describe("words", () => {
  test("each mode has a name and says what it means", () => {
    expect(Mode.MODES.map((mode) => [mode.value, ru(mode.label)])).toEqual([
      ["ask", "Спрашивать"],
      ["edit", "Править сам"],
      ["full", "Полный доступ"],
    ])
    expect(Mode.MODES.every((mode) => mode.hint.length > 20)).toBe(true)
    expect(Mode.MODES.every((mode) => ru(mode.hint) !== mode.hint)).toBe(true)
  })

  test("the source words are English", () => {
    expect(Mode.short("edit")).toBe("Edit on its own")
    expect(ru(Mode.REJECT_PLACEHOLDER)).toBe("Что сделать вместо этого — уйдёт модели, ход продолжится")
    expect(ru(Mode.SUBAGENT)).toBe("от субагента")
  })

  test("the short name for narrow places", () => {
    expect(Mode.short("ask", ru)).toBe("Спрашивать")
    expect(Mode.short("full", ru)).toBe("Полный доступ")
    expect(Mode.short(undefined, ru)).toBe("Свои правила")
  })
})

describe("a permission request", () => {
  test("says what «always» will remember", () => {
    expect(Mode.alwaysNote({ action: "shell", save: ["npm test *"] }, ru)).toBe(
      "«Всегда» запомнит для этого проекта: команды npm test *.",
    )
    expect(Mode.alwaysNote({ action: "edit", save: ["*"] }, ru)).toBe(
      "«Всегда» запомнит для этого проекта: правку любых файлов.",
    )
    expect(Mode.alwaysNote({ action: "external_directory", save: ["/tmp/x/*"] }, ru)).toBe(
      "«Всегда» запомнит для этого проекта: доступ к /tmp/x/*.",
    )
    expect(Mode.alwaysNote({ action: "github_create_issue", save: ["*"] }, ru)).toBe(
      "«Всегда» запомнит для этого проекта: инструмент github_create_issue — любые вызовы.",
    )
  })

  test("nothing to remember — «always» is not offered", () => {
    expect(Mode.alwaysNote({ action: "shell", save: [] })).toBeUndefined()
    expect(Mode.alwaysNote({ action: "shell" })).toBeUndefined()
  })

  test("a request of a subagent is told apart from one's own", () => {
    const sessions = [{ id: "main" }, { id: "child", parentID: "main" }]
    expect(Mode.fromSubagent({ sessionID: "child" }, sessions)).toBe(true)
    expect(Mode.fromSubagent({ sessionID: "main" }, sessions)).toBe(false)
    expect(Mode.fromSubagent({ sessionID: "unknown" }, sessions)).toBe(false)
  })
})
